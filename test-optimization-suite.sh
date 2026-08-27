#!/bin/bash

# ============================================================================
# Optimization & Edge Case Suite v2
# Concurrency, memory (RSS gateway), edge cases, cycle, deep nesting,
# timeout, large payload
# ============================================================================

GATEWAY="http://localhost:4123"
OUTPUT_DIR="/tmp/optimization-test-results"
mkdir -p "$OUTPUT_DIR"
FAILS=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
NC='\033[0m'

get_field() {
  node -e "
    const fs=require('fs');
    let r=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
    for(const k of process.argv[2].split('.')){
      if(r==null){ r=null; break; }
      if(typeof r==='string'){ try{ r=JSON.parse(r); }catch(e){ r=null; break; } }
      r=r[k];
    }
    console.log(r==null?'':(typeof r==='object'?JSON.stringify(r):String(r)));
  " "$1" "$2"
}

assert_eq() {
  local actual=$(get_field "$1" "$2")
  if [ "$actual" = "$3" ]; then
    echo -e "${GREEN}  ✓ $2 = $3${NC}"
  else
    echo -e "${RED}  ✗ $2: expected '$3', got '$actual'${NC}"
    FAILS=$((FAILS+1))
  fi
}

# Parse SSE file -> status
sse_status() {
  node -e "
    const fs=require('fs');
    const sse=fs.readFileSync(process.argv[1],'utf8');
    const evs=sse.split('\n').filter(l=>l.startsWith('data:')).map(l=>{
      try{return JSON.parse(l.slice(5))}catch(e){return null}
    }).filter(Boolean);
    const err=evs.find(e=>e.type==='error');
    const c=evs.find(e=>e.type==='complete');
    console.log(err ? 'error' : (c && c.success ? 'success' : 'error'));
  " "$1"
}

execute_workflow() {
  local workflow_file="$1"
  local input_text="$2"
  local output_file="$3"

  if [ -n "$input_text" ]; then
    node -e "
      const fs = require('fs');
      const wf = JSON.parse(fs.readFileSync('$workflow_file', 'utf8'));
      wf.nodes.find(n => n.id === '1').data.context = process.argv[1];
      fs.writeFileSync('$output_file.request.json', JSON.stringify(wf));
    " "$input_text"
  else
    cp "$workflow_file" "$output_file.request.json"
  fi

  local start_time=$(date +%s%3N)
  curl -s -X POST "$GATEWAY/v1/workflow/execute" \
    -H "Content-Type: application/json" \
    -d @"$output_file.request.json" > "$output_file.sse" 2>&1
  local end_time=$(date +%s%3N)

  node -e "
    const fs = require('fs');
    const sse = fs.readFileSync('$output_file.sse', 'utf8');
    const events = sse.split('\n').filter(l => l.startsWith('data:')).map(l => {
      try { return JSON.parse(l.substring(5)); } catch(e) { return null; }
    }).filter(Boolean);
    const complete = events.find(e => e.type === 'complete');
    const errorEvt = events.find(e => e.type === 'error');
    let status='success', errorMsg=null;
    if (errorEvt) { status='error'; errorMsg=errorEvt.error; }
    else if (complete && complete.success===false) { status='error'; errorMsg='workflow failed'; }
    else if (!complete) { status='error'; errorMsg='no complete event'; }
    fs.writeFileSync('$output_file.result.json', JSON.stringify({
      status, error: errorMsg,
      results: complete ? complete.results : {},
      duration_ms: $((end_time - start_time))
    }));
  " 2>/dev/null
  echo $((end_time - start_time))
}

# RSS gateway (MB) — ukur process gateway sesungguhnya via /proc
gateway_rss_mb() {
  local pid=$(pgrep -f "node server/gateway.mjs" | head -1)
  if [ -z "$pid" ]; then echo "0"; return; fi
  awk '/VmRSS/{printf "%.2f", $2/1024}' /proc/$pid/status 2>/dev/null || echo "0"
}

echo -e "${MAGENTA}========================================${NC}"
echo -e "${MAGENTA}   Optimization & Edge Case Suite v2   ${NC}"
echo -e "${MAGENTA}========================================${NC}"
echo ""

curl -s "$GATEWAY/admin/api/status" > /dev/null 2>&1 || { echo -e "${RED}❌ Gateway down${NC}"; exit 1; }
echo -e "${GREEN}✓ Gateway running${NC}"
echo ""

# ============================================================================
# TEST 1: Concurrency Stress (10 parallel)
# ============================================================================
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}TEST 1: Concurrency Stress (10 parallel)${NC}"
echo -e "${BLUE}========================================${NC}"

cat > "$OUTPUT_DIR/wf-conc.json" << 'EOF'
{
  "name": "Concurrent Test",
  "nodes": [
    {"id":"1","type":"trigger","position":{"x":0,"y":0},"data":{"label":"Input"}},
    {"id":"2","type":"code","position":{"x":250,"y":0},"data":{
      "label":"Process",
      "code":"const input = {context_obj}; const start = Date.now(); while(Date.now() - start < 50) {} console.log(JSON.stringify({processed: input}));"
    }},
    {"id":"3","type":"output","position":{"x":500,"y":0},"data":{"label":"Output"}}
  ],
  "edges":[
    {"id":"e1","source":"1","target":"2"},
    {"id":"e2","source":"2","target":"3"}
  ]
}
EOF

echo "Launching 10 parallel executions..."
START_CONC=$(date +%s%3N)
for i in $(seq 1 10); do
  (
    node -e "
      const fs=require('fs');
      const wf=JSON.parse(fs.readFileSync('$OUTPUT_DIR/wf-conc.json','utf8'));
      wf.nodes.find(n=>n.id==='1').data.context='test-$i';
      fs.writeFileSync('$OUTPUT_DIR/conc-$i.request.json', JSON.stringify(wf));
    "
    curl -s -X POST "$GATEWAY/v1/workflow/execute" \
      -H "Content-Type: application/json" \
      -d @"$OUTPUT_DIR/conc-$i.request.json" > "$OUTPUT_DIR/conc-$i.sse" 2>&1
  ) &
done
wait
END_CONC=$(date +%s%3N)
CONC_WALL=$((END_CONC - START_CONC))
echo "Wall time: ${CONC_WALL}ms (10 parallel)"

SUCCESS_COUNT=0
for i in $(seq 1 10); do
  ST=$(sse_status "$OUTPUT_DIR/conc-$i.sse")
  if [ "$ST" = "success" ]; then SUCCESS_COUNT=$((SUCCESS_COUNT + 1)); fi
done

if [ "$SUCCESS_COUNT" -eq 10 ]; then
  echo -e "${GREEN}  ✓ All 10 concurrent workflows succeeded${NC}"
else
  echo -e "${RED}  ✗ Only $SUCCESS_COUNT/10 succeeded${NC}"
  FAILS=$((FAILS+1))
fi
echo ""

# ============================================================================
# TEST 2: Memory Stability (50 sequential, RSS gateway)
# ============================================================================
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}TEST 2: Memory Stability (50 runs)${NC}"
echo -e "${BLUE}========================================${NC}"

cat > "$OUTPUT_DIR/wf-memory.json" << 'EOF'
{
  "name": "Memory Test",
  "nodes": [
    {"id":"1","type":"trigger","position":{"x":0,"y":0},"data":{"label":"Input"}},
    {"id":"2","type":"code","position":{"x":250,"y":0},"data":{
      "label":"Allocate",
      "code":"const arr = new Array(10000).fill('x'.repeat(100)); console.log(JSON.stringify({size: arr.length}));"
    }},
    {"id":"3","type":"output","position":{"x":500,"y":0},"data":{"label":"Output"}}
  ],
  "edges":[
    {"id":"e1","source":"1","target":"2"},
    {"id":"e2","source":"2","target":"3"}
  ]
}
EOF

RSS_BEFORE=$(gateway_rss_mb)
echo "Gateway RSS before: ${RSS_BEFORE}MB"

START_MEM=$(date +%s%3N)
for i in $(seq 1 50); do
  execute_workflow "$OUTPUT_DIR/wf-memory.json" "run-$i" "$OUTPUT_DIR/memory-$i" > /dev/null 2>&1
done
END_MEM=$(date +%s%3N)

RSS_AFTER=$(gateway_rss_mb)
MEM_GROWTH=$(node -e "console.log((($RSS_AFTER) - ($RSS_BEFORE)).toFixed(2))")
AVG_TIME=$(( (END_MEM - START_MEM) / 50 ))

echo "Gateway RSS after: ${RSS_AFTER}MB"
echo "Memory growth: ${MEM_GROWTH}MB"
echo "Average time per run: ${AVG_TIME}ms"

if node -e "process.exit(($MEM_GROWTH) < 50 ? 0 : 1)"; then
  echo -e "${GREEN}  ✓ Memory growth acceptable (< 50MB)${NC}"
else
  echo -e "${RED}  ✗ Memory leak detected: ${MEM_GROWTH}MB growth${NC}"
  FAILS=$((FAILS+1))
fi

if [ "$AVG_TIME" -lt 500 ]; then
  echo -e "${GREEN}  ✓ Average time acceptable (< 500ms)${NC}"
else
  echo -e "${YELLOW}  ⚠ Average time high: ${AVG_TIME}ms${NC}"
fi
echo ""

# ============================================================================
# TEST 3: Edge Cases (Empty / Single / Disconnected)
# ============================================================================
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}TEST 3: Edge Cases${NC}"
echo -e "${BLUE}========================================${NC}"

cat > "$OUTPUT_DIR/wf-empty.json" << 'EOF'
{"name":"Empty Workflow","nodes":[],"edges":[]}
EOF
execute_workflow "$OUTPUT_DIR/wf-empty.json" "" "$OUTPUT_DIR/test-empty" > /dev/null
assert_eq "$OUTPUT_DIR/test-empty.result.json" "status" "success"

cat > "$OUTPUT_DIR/wf-single.json" << 'EOF'
{
  "name": "Single Node",
  "nodes": [
    {"id":"1","type":"output","position":{"x":0,"y":0},"data":{"label":"Output"}}
  ],
  "edges": []
}
EOF
execute_workflow "$OUTPUT_DIR/wf-single.json" "" "$OUTPUT_DIR/test-single" > /dev/null
assert_eq "$OUTPUT_DIR/test-single.result.json" "status" "success"

cat > "$OUTPUT_DIR/wf-disconnected.json" << 'EOF'
{
  "name": "Disconnected",
  "nodes": [
    {"id":"1","type":"trigger","position":{"x":0,"y":0},"data":{"label":"A"}},
    {"id":"2","type":"output","position":{"x":250,"y":0},"data":{"label":"B"}},
    {"id":"3","type":"output","position":{"x":500,"y":0},"data":{"label":"C"}}
  ],
  "edges": [
    {"id":"e1","source":"1","target":"2"}
  ]
}
EOF
execute_workflow "$OUTPUT_DIR/wf-disconnected.json" "test" "$OUTPUT_DIR/test-disconnected" > /dev/null
assert_eq "$OUTPUT_DIR/test-disconnected.result.json" "status" "success"
echo ""

# ============================================================================
# TEST 4: Circular Dependency Detection
# ============================================================================
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}TEST 4: Circular Dependency Detection${NC}"
echo -e "${BLUE}========================================${NC}"

cat > "$OUTPUT_DIR/wf-circular.json" << 'EOF'
{
  "name": "Circular Workflow",
  "nodes": [
    {"id":"1","type":"trigger","position":{"x":0,"y":0},"data":{"label":"A"}},
    {"id":"2","type":"code","position":{"x":250,"y":0},"data":{"label":"B","code":"console.log(JSON.stringify({step:'B'}));"}},
    {"id":"3","type":"code","position":{"x":500,"y":0},"data":{"label":"C","code":"console.log(JSON.stringify({step:'C'}));"}},
    {"id":"4","type":"output","position":{"x":750,"y":0},"data":{"label":"D"}}
  ],
  "edges": [
    {"id":"e1","source":"1","target":"2"},
    {"id":"e2","source":"2","target":"3"},
    {"id":"e3","source":"3","target":"2"},
    {"id":"e4","source":"3","target":"4"}
  ]
}
EOF

execute_workflow "$OUTPUT_DIR/wf-circular.json" "test" "$OUTPUT_DIR/test-circular" > /dev/null
CIRC_STATUS=$(get_field "$OUTPUT_DIR/test-circular.result.json" "status")
CIRC_ERROR=$(get_field "$OUTPUT_DIR/test-circular.result.json" "error")

if [ "$CIRC_STATUS" = "error" ] && echo "$CIRC_ERROR" | grep -qi "cycle"; then
  echo -e "${GREEN}  ✓ Circular dependency detected correctly${NC}"
  echo -e "${GREEN}  ✓ Error: ${CIRC_ERROR:0:60}...${NC}"
else
  echo -e "${RED}  ✗ Should detect cycle, got status: $CIRC_STATUS${NC}"
  FAILS=$((FAILS+1))
fi
echo ""

# ============================================================================
# TEST 5: Deep Nesting (10 levels)
# ============================================================================
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}TEST 5: Deep Nesting (10 levels)${NC}"
echo -e "${BLUE}========================================${NC}"

node -e "
  const nodes = [{id:'1',type:'trigger',position:{x:0,y:0},data:{label:'Start',context:'1'}}];
  const edges = [];
  for (let i = 2; i <= 10; i++) {
    nodes.push({id:String(i),type:'code',position:{x:(i-1)*250,y:0},data:{
      label:'L'+(i-1),
      code:'const val = parseInt({context_obj}) + 1; console.log(JSON.stringify(val));'
    }});
    edges.push({id:'e'+(i-1),source:String(i-1),target:String(i)});
  }
  nodes.push({id:'11',type:'output',position:{x:2500,y:0},data:{label:'Final'}});
  edges.push({id:'e10',source:'10',target:'11'});
  require('fs').writeFileSync('$OUTPUT_DIR/wf-deep.json', JSON.stringify({name:'Deep Nesting',nodes,edges}, null, 2));
"

D_DEEP=$(execute_workflow "$OUTPUT_DIR/wf-deep.json" "" "$OUTPUT_DIR/test-deep")
echo "Duration: ${D_DEEP}ms"
assert_eq "$OUTPUT_DIR/test-deep.result.json" "status" "success"
assert_eq "$OUTPUT_DIR/test-deep.result.json" "results.11" "10"
echo ""

# ============================================================================
# TEST 6: Timeout Handling (sandbox 5s limit)
# ============================================================================
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}TEST 6: Timeout Handling${NC}"
echo -e "${BLUE}========================================${NC}"

cat > "$OUTPUT_DIR/wf-timeout.json" << 'EOF'
{
  "name": "Timeout Test",
  "nodes": [
    {"id":"1","type":"trigger","position":{"x":0,"y":0},"data":{"label":"Start"}},
    {"id":"2","type":"code","position":{"x":250,"y":0},"data":{
      "label":"Infinite Loop",
      "code":"const start = Date.now(); while(Date.now() - start < 10000) {} console.log(JSON.stringify({done:true}));"
    }},
    {"id":"3","type":"output","position":{"x":500,"y":0},"data":{"label":"Output"}}
  ],
  "edges":[
    {"id":"e1","source":"1","target":"2"},
    {"id":"e2","source":"2","target":"3"}
  ]
}
EOF

START_TO=$(date +%s%3N)
execute_workflow "$OUTPUT_DIR/wf-timeout.json" "test" "$OUTPUT_DIR/test-timeout" > /dev/null
END_TO=$(date +%s%3N)
TO_DURATION=$((END_TO - START_TO))

TO_STATUS=$(get_field "$OUTPUT_DIR/test-timeout.result.json" "status")
TO_ERROR=$(get_field "$OUTPUT_DIR/test-timeout.result.json" "error")

if [ "$TO_STATUS" = "error" ] && echo "$TO_ERROR" | grep -qi "timeout"; then
  echo -e "${GREEN}  ✓ Timeout handled correctly${NC}"
else
  echo -e "${RED}  ✗ Expected timeout error, got status: $TO_STATUS${NC}"
  FAILS=$((FAILS+1))
fi

if [ "$TO_DURATION" -lt 7000 ]; then
  echo -e "${GREEN}  ✓ Timeout enforced (${TO_DURATION}ms < 7s)${NC}"
else
  echo -e "${RED}  ✗ Timeout not enforced: ${TO_DURATION}ms${NC}"
  FAILS=$((FAILS+1))
fi
echo ""

# ============================================================================
# TEST 7: Large Payload (50KB context)
# ============================================================================
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}TEST 7: Large Payload (50KB)${NC}"
echo -e "${BLUE}========================================${NC}"

cat > "$OUTPUT_DIR/wf-large.json" << 'EOF'
{
  "name": "Large Payload",
  "nodes": [
    {"id":"1","type":"trigger","position":{"x":0,"y":0},"data":{"label":"Big Input"}},
    {"id":"2","type":"code","position":{"x":250,"y":0},"data":{
      "label":"Measure",
      "code":"const s = {context_obj}; console.log(JSON.stringify({len: s.length, head: s.substring(0,5)}));"
    }},
    {"id":"3","type":"output","position":{"x":500,"y":0},"data":{"label":"Output"}}
  ],
  "edges":[
    {"id":"e1","source":"1","target":"2"},
    {"id":"e2","source":"2","target":"3"}
  ]
}
EOF

LARGE_INPUT=$(node -e "console.log('x'.repeat(50000))")
D_LARGE=$(execute_workflow "$OUTPUT_DIR/wf-large.json" "$LARGE_INPUT" "$OUTPUT_DIR/test-large")
echo "Duration: ${D_LARGE}ms"
assert_eq "$OUTPUT_DIR/test-large.result.json" "status" "success"
assert_eq "$OUTPUT_DIR/test-large.result.json" "results.2.len" "50000"
echo ""

# ============================================================================
# SUMMARY
# ============================================================================
echo -e "${MAGENTA}========================================${NC}"
echo -e "${MAGENTA}       OPTIMIZATION SUMMARY             ${NC}"
echo -e "${MAGENTA}========================================${NC}"
echo ""

if [ "$FAILS" -eq 0 ]; then
  echo -e "${GREEN}✓ ALL OPTIMIZATION TESTS PASSED${NC}"
  echo ""
  echo -e "${GREEN}Engine validated for:${NC}"
  echo "  ✓ Concurrent execution (10 parallel)"
  echo "  ✓ Memory stability (50 runs, RSS gateway)"
  echo "  ✓ Edge cases (empty / single / disconnected)"
  echo "  ✓ Circular dependency detection"
  echo "  ✓ Deep nesting (10 levels)"
  echo "  ✓ Timeout enforcement"
  echo "  ✓ Large payload (50KB)"
  exit 0
else
  echo -e "${RED}❌ $FAILS OPTIMIZATION TESTS FAILED${NC}"
  exit 1
fi