#!/bin/bash

# ============================================================================
# Production-Grade AI Automation Test Suite (v6 — Test E fixed)
# ============================================================================

GATEWAY="http://localhost:4123"
OUTPUT_DIR="/tmp/production-test-results"
mkdir -p "$OUTPUT_DIR"
FAILS=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
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

assert_contains() {
  local actual=$(get_field "$1" "$2")
  if echo "$actual" | grep -q "$3"; then
    echo -e "${GREEN}  ✓ $2 contains '$3'${NC}"
  else
    echo -e "${RED}  ✗ $2 missing '$3'${NC}"
    FAILS=$((FAILS+1))
  fi
}

assert_gt() {
  local actual=$(get_field "$1" "$2")
  if [ "$actual" -gt "$3" ] 2>/dev/null; then
    echo -e "${GREEN}  ✓ $2 > $3 (actual: $actual)${NC}"
  else
    echo -e "${RED}  ✗ $2 should be > $3, got '$actual'${NC}"
    FAILS=$((FAILS+1))
  fi
}

assert_match() {
  local actual=$(get_field "$1" "$2")
  if echo "$actual" | grep -Eq "$3"; then
    echo -e "${GREEN}  ✓ $2 matches pattern '$3'${NC}"
  else
    echo -e "${RED}  ✗ $2 doesn't match '$3', got '$actual'${NC}"
    FAILS=$((FAILS+1))
  fi
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

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  Production-Grade AI Automation Suite  ${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

curl -s "$GATEWAY/admin/api/status" > /dev/null 2>&1 || { echo -e "${RED}❌ Gateway down${NC}"; exit 1; }
echo -e "${GREEN}✓ Gateway running${NC}"
echo ""

# ============================================================================
# TEST A: Image Generation Pipeline
# ============================================================================
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}TEST A: Image Generation Pipeline${NC}"
echo -e "${BLUE}========================================${NC}"

cat > "$OUTPUT_DIR/wf-image.json" << 'EOF'
{
  "name": "Image Pipeline",
  "nodes": [
    {"id":"1","type":"trigger","position":{"x":0,"y":0},"data":{"label":"Design Brief"}},
    {"id":"2","type":"ai","position":{"x":250,"y":0},"data":{
      "label":"AI Prompt Engineer",
      "prompt":"Convert this design brief into ONE concise English image prompt for Flux model. Output ONLY the prompt, no explanations.\n\nBrief: {context}"
    }},
    {"id":"3","type":"tool","position":{"x":500,"y":0},"data":{
      "label":"Generate Image",
      "toolName":"image_gen",
      "params":{"prompt":"{context}","width":512,"height":512}
    }},
    {"id":"4","type":"tool","position":{"x":750,"y":0},"data":{
      "label":"Save to File",
      "toolName":"file_rw",
      "params":{"action":"write","filename":"test-pipeline.jpg","content":"saved from pipeline"}
    }},
    {"id":"5","type":"output","position":{"x":1000,"y":0},"data":{"label":"Final"}}
  ],
  "edges":[
    {"id":"e1","source":"1","target":"2"},
    {"id":"e2","source":"2","target":"3"},
    {"id":"e3","source":"3","target":"4"},
    {"id":"e4","source":"4","target":"5"}
  ]
}
EOF

DA=$(execute_workflow "$OUTPUT_DIR/wf-image.json" "kaos vintage rock band aesthetic 80s" "$OUTPUT_DIR/testA")
echo "Duration: ${DA}ms"
assert_eq "$OUTPUT_DIR/testA.result.json" "status" "success"
assert_contains "$OUTPUT_DIR/testA.result.json" "results.3.url" "pollinations.ai"
assert_gt "$OUTPUT_DIR/testA.result.json" "results.3.size" 10000
assert_match "$OUTPUT_DIR/testA.result.json" "results.3.file" "img_[0-9]+"
assert_eq "$OUTPUT_DIR/testA.result.json" "results.4.success" "true"

SAVED_FILE=$(get_field "$OUTPUT_DIR/testA.result.json" "results.3.file")
if [ -f "server/data/tools/$SAVED_FILE" ]; then
  echo -e "${GREEN}  ✓ File benar-benar ada: server/data/tools/$SAVED_FILE${NC}"
else
  echo -e "${RED}  ✗ File TIDAK ditemukan di disk!${NC}"
  FAILS=$((FAILS+1))
fi
echo ""

# ============================================================================
# TEST B: Parallel Aggregation (3 Branches)
# ============================================================================
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}TEST B: Parallel Aggregation (3 Branches)${NC}"
echo -e "${BLUE}========================================${NC}"

cat > "$OUTPUT_DIR/wf-parallel.json" << 'EOF'
{
  "name": "Parallel Aggregation",
  "nodes": [
    {"id":"1","type":"trigger","position":{"x":0,"y":0},"data":{"label":"Input","context":"7"}},
    {"id":"2","type":"tool","position":{"x":250,"y":-100},"data":{
      "label":"Branch 1: Math",
      "toolName":"math",
      "params":{"expression":"{context} * 10"}
    }},
    {"id":"3","type":"code","position":{"x":250,"y":0},"data":{
      "label":"Branch 2: Code",
      "code":"const n = parseInt({context_obj}); console.log(JSON.stringify({branch:'code', value: n*n}));"
    }},
    {"id":"4","type":"ai","position":{"x":250,"y":100},"data":{
      "label":"Branch 3: AI",
      "prompt":"Reply with EXACTLY this JSON and nothing else: {\"branch\":\"ai\",\"message\":\"received {context}\"}"
    }},
    {"id":"5","type":"output","position":{"x":500,"y":0},"data":{"label":"Merged"}}
  ],
  "edges":[
    {"id":"e1","source":"1","target":"2"},
    {"id":"e2","source":"1","target":"3"},
    {"id":"e3","source":"1","target":"4"},
    {"id":"e4","source":"2","target":"5"},
    {"id":"e5","source":"3","target":"5"},
    {"id":"e6","source":"4","target":"5"}
  ]
}
EOF

DB=$(execute_workflow "$OUTPUT_DIR/wf-parallel.json" "" "$OUTPUT_DIR/testB")
echo "Duration: ${DB}ms"
assert_eq "$OUTPUT_DIR/testB.result.json" "status" "success"
assert_eq "$OUTPUT_DIR/testB.result.json" "results.2.result" "70"
assert_eq "$OUTPUT_DIR/testB.result.json" "results.3.value" "49"
assert_contains "$OUTPUT_DIR/testB.result.json" "results.4" "received 7"

OUTPUT5=$(get_field "$OUTPUT_DIR/testB.result.json" "results.5")
ITEMS_COUNT=$(echo "$OUTPUT5" | node -e "
  let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
    try { console.log(JSON.parse(d).length); }
    catch(e){ console.log(0); }
  });
")
if [ "$ITEMS_COUNT" -ge 3 ] 2>/dev/null; then
  echo -e "${GREEN}  ✓ Output node terima $ITEMS_COUNT items (3 branch merged)${NC}"
else
  echo -e "${RED}  ✗ Expected 3 items, got '$ITEMS_COUNT'${NC}"
  FAILS=$((FAILS+1))
fi
echo ""

# ============================================================================
# TEST C: Error Recovery (continueOnFail)
# ============================================================================
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}TEST C: Error Recovery (continueOnFail)${NC}"
echo -e "${BLUE}========================================${NC}"

cat > "$OUTPUT_DIR/wf-recovery.json" << 'EOF'
{
  "name": "Error Recovery",
  "nodes": [
    {"id":"1","type":"trigger","position":{"x":0,"y":0},"data":{"label":"Input"}},
    {"id":"2","type":"code","position":{"x":250,"y":0},"data":{
      "label":"Sengaja Error",
      "code":"throw new Error('simulated failure');",
      "continueOnFail": true
    }},
    {"id":"3","type":"code","position":{"x":500,"y":0},"data":{
      "label":"Recovery",
      "code":"const prev = {context_obj}; console.log(JSON.stringify({recovered: true, got_error: !!prev.error}));"
    }},
    {"id":"4","type":"output","position":{"x":750,"y":0},"data":{"label":"Final"}}
  ],
  "edges":[
    {"id":"e1","source":"1","target":"2"},
    {"id":"e2","source":"2","target":"3"},
    {"id":"e3","source":"3","target":"4"}
  ]
}
EOF

DC=$(execute_workflow "$OUTPUT_DIR/wf-recovery.json" "test" "$OUTPUT_DIR/testC")
echo "Duration: ${DC}ms"
assert_eq "$OUTPUT_DIR/testC.result.json" "status" "success"

NODE2_STATUS=$(get_field "$OUTPUT_DIR/testC.result.json" "results.2.error")
if [ -n "$NODE2_STATUS" ]; then
  echo -e "${GREEN}  ✓ Node 2 mencatat error: ${NODE2_STATUS:0:60}...${NC}"
else
  echo -e "${RED}  ✗ Node 2 seharusnya error tapi tidak${NC}"
  FAILS=$((FAILS+1))
fi

assert_eq "$OUTPUT_DIR/testC.result.json" "results.3.recovered" "true"
assert_eq "$OUTPUT_DIR/testC.result.json" "results.3.got_error" "true"
echo ""

# ============================================================================
# TEST D: Array Processing (Map Pattern)
# ============================================================================
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}TEST D: Array Processing (Map Pattern)${NC}"
echo -e "${BLUE}========================================${NC}"

cat > "$OUTPUT_DIR/wf-array.json" << 'EOF'
{
  "name": "Array Processing",
  "nodes": [
    {"id":"1","type":"trigger","position":{"x":0,"y":0},"data":{
      "label":"CSV Input",
      "context":"1,2,3,4,5,6,7,8,9,10"
    }},
    {"id":"2","type":"code","position":{"x":250,"y":0},"data":{
      "label":"Parse & Square",
      "code":"const csv = {context_obj}; const nums = csv.split(',').map(Number); const squares = nums.map(n => ({num: n, sq: n*n, even: n%2===0})); console.log(JSON.stringify(squares));"
    }},
    {"id":"3","type":"code","position":{"x":500,"y":0},"data":{
      "label":"Aggregate",
      "code":"const items = {context_obj}; const sumSq = items.reduce((acc, it) => acc + it.sq, 0); const evens = items.filter(it => it.even).length; console.log(JSON.stringify({count: items.length, sumSq, evens, odds: items.length - evens}));"
    }},
    {"id":"4","type":"output","position":{"x":750,"y":0},"data":{"label":"Aggregated"}}
  ],
  "edges":[
    {"id":"e1","source":"1","target":"2"},
    {"id":"e2","source":"2","target":"3"},
    {"id":"e3","source":"3","target":"4"}
  ]
}
EOF

DD=$(execute_workflow "$OUTPUT_DIR/wf-array.json" "" "$OUTPUT_DIR/testD")
echo "Duration: ${DD}ms"
assert_eq "$OUTPUT_DIR/testD.result.json" "status" "success"
assert_eq "$OUTPUT_DIR/testD.result.json" "results.3.count" "10"
assert_eq "$OUTPUT_DIR/testD.result.json" "results.3.evens" "5"
assert_eq "$OUTPUT_DIR/testD.result.json" "results.3.odds" "5"
assert_eq "$OUTPUT_DIR/testD.result.json" "results.3.sumSq" "385"
echo ""

# ============================================================================
# TEST E: Real-World Data Engineering (FIXED assertions)
# ============================================================================
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}TEST E: Real-World Data Engineering${NC}"
echo -e "${BLUE}========================================${NC}"

cat > "$OUTPUT_DIR/wf-data.json" << 'EOF'
{
  "name": "Sales Analytics",
  "nodes": [
    {"id":"1","type":"trigger","position":{"x":0,"y":0},"data":{
      "label":"Sales Data (JSON array)",
      "context":"[{\"id\":\"S001\",\"product\":\"Laptop\",\"amount\":15000000,\"region\":\"Jakarta\"},{\"id\":\"S002\",\"product\":\"Mouse\",\"amount\":250000,\"region\":\"Bandung\"},{\"id\":\"S003\",\"product\":\"Laptop\",\"amount\":15500000,\"region\":\"Surabaya\"},{\"id\":\"S004\",\"product\":\"Keyboard\",\"amount\":750000,\"region\":\"Jakarta\"},{\"id\":\"S005\",\"product\":\"Monitor\",\"amount\":3500000,\"region\":\"Jakarta\"},{\"id\":\"S006\",\"product\":\"Laptop\",\"amount\":14800000,\"region\":\"Medan\"},{\"id\":\"S007\",\"product\":\"Mouse\",\"amount\":300000,\"region\":\"Jakarta\"},{\"id\":\"S008\",\"product\":\"Monitor\",\"amount\":3200000,\"region\":\"Bandung\"}]"
    }},
    {"id":"2","type":"code","position":{"x":250,"y":0},"data":{
      "label":"Filter High-Value",
      "code":"const sales = {context_obj}; const high = sales.filter(s => s.amount >= 1000000); console.log(JSON.stringify(high));"
    }},
    {"id":"3","type":"code","position":{"x":500,"y":0},"data":{
      "label":"Group by Product",
      "code":"const high = {context_obj}; const grouped = {}; high.forEach(s => { if(!grouped[s.product]) grouped[s.product] = {count:0, total:0, regions:[]}; grouped[s.product].count++; grouped[s.product].total += s.amount; if(!grouped[s.product].regions.includes(s.region)) grouped[s.product].regions.push(s.region); }); console.log(JSON.stringify(grouped));"
    }},
    {"id":"4","type":"code","position":{"x":750,"y":0},"data":{
      "label":"Find Top Product",
      "code":"const grouped = {context_obj}; const entries = Object.entries(grouped).map(([name, data]) => ({name, ...data})); entries.sort((a,b) => b.total - a.total); const top = entries[0]; console.log(JSON.stringify({top_product: top.name, top_revenue: top.total, total_products: entries.length, breakdown: entries}));"
    }},
    {"id":"5","type":"output","position":{"x":1000,"y":0},"data":{"label":"Analytics"}}
  ],
  "edges":[
    {"id":"e1","source":"1","target":"2"},
    {"id":"e2","source":"2","target":"3"},
    {"id":"e3","source":"3","target":"4"},
    {"id":"e4","source":"4","target":"5"}
  ]
}
EOF

DE=$(execute_workflow "$OUTPUT_DIR/wf-data.json" "" "$OUTPUT_DIR/testE")
echo "Duration: ${DE}ms"
assert_eq "$OUTPUT_DIR/testE.result.json" "status" "success"
assert_eq "$OUTPUT_DIR/testE.result.json" "results.4.top_product" "Laptop"
assert_eq "$OUTPUT_DIR/testE.result.json" "results.4.top_revenue" "45300000"
# [FIX] Hanya 2 products lolos filter >= 1M (Laptop + Monitor)
assert_eq "$OUTPUT_DIR/testE.result.json" "results.4.total_products" "2"
assert_eq "$OUTPUT_DIR/testE.result.json" "results.4.breakdown.0.name" "Laptop"
assert_eq "$OUTPUT_DIR/testE.result.json" "results.4.breakdown.1.name" "Monitor"
assert_eq "$OUTPUT_DIR/testE.result.json" "results.4.breakdown.1.total" "6700000"
assert_eq "$OUTPUT_DIR/testE.result.json" "results.4.breakdown.1.count" "2"

TOTAL_SALES=$(node -e "
  const fs = require('fs');
  const r = JSON.parse(fs.readFileSync('$OUTPUT_DIR/testE.result.json', 'utf8'));
  const breakdown = JSON.parse(r.results['4']).breakdown;
  console.log(breakdown.reduce((s, p) => s + p.count, 0));
")
if [ "$TOTAL_SALES" -eq 5 ]; then
  echo -e "${GREEN}  ✓ breakdown total count = 5 (3 laptop + 2 monitor)${NC}"
else
  echo -e "${RED}  ✗ expected 5 high-value sales, got $TOTAL_SALES${NC}"
  FAILS=$((FAILS+1))
fi
echo ""

# ============================================================================
# SUMMARY
# ============================================================================
echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}          FINAL SUMMARY                 ${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""
echo -e "${YELLOW}Test Durations:${NC}"
echo "  A (Image Pipeline):       ${DA}ms"
echo "  B (Parallel Aggregation): ${DB}ms"
echo "  C (Error Recovery):       ${DC}ms"
echo "  D (Array Processing):     ${DD}ms"
echo "  E (Data Engineering):     ${DE}ms"
TOTAL=$((DA + DB + DC + DD + DE))
echo "  ─────────────────────────"
echo "  TOTAL:                    ${TOTAL}ms"
echo ""

if [ "$FAILS" -eq 0 ]; then
  echo -e "${GREEN}========================================${NC}"
  echo -e "${GREEN}  ✓ ALL 5 TESTS PASSED (0 failures)    ${NC}"
  echo -e "${GREEN}========================================${NC}"
  exit 0
else
  echo -e "${RED}========================================${NC}"
  echo -e "${RED}  ❌ $FAILS ASSERTIONS FAILED           ${NC}"
  echo -e "${RED}========================================${NC}"
  exit 1
fi