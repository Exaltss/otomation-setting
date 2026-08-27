/**
 * Tipe node untuk React Flow.
 */
import type { Node } from '@xyflow/react';
import type { WorkflowNodeData, WorkflowNodeType } from '../../services/workflowClient';

export type FlowNode = Node<WorkflowNodeData, WorkflowNodeType>;
export type NodeStatus = 'pending' | 'running' | 'done' | 'error';