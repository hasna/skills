// Base entity with common fields
export interface BaseEntity {
  id: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

// Enum types
export type OwnerType = 'human' | 'agent';
export type ActivityStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type WorkflowStatus = 'draft' | 'active' | 'paused' | 'archived';
export type TriggerType = 'manual' | 'scheduled' | 'event' | 'condition';
export type ResponsibilityType = 'owner' | 'accountable' | 'consulted' | 'informed';

// Owner (human or AI agent)
export interface Owner extends BaseEntity {
  name: string;
  ownerType: OwnerType;
  email?: string;
  capabilities?: string[];
}

// Team
export interface Team extends BaseEntity {
  name: string;
  description?: string;
}

// Team Member (junction)
export interface TeamMember {
  teamId: string;
  ownerId: string;
  role?: string;
  createdAt: string;
}

// Business Function (hierarchical)
export interface Function extends BaseEntity {
  name: string;
  description?: string;
  parentId?: string;
}

// Activity (under a function)
export interface Activity extends BaseEntity {
  functionId: string;
  name: string;
  description?: string;
  status: ActivityStatus;
}

// Workflow
export interface Workflow extends BaseEntity {
  name: string;
  description?: string;
  triggerType: TriggerType;
  status: WorkflowStatus;
}

// Workflow Step
export interface WorkflowStep extends BaseEntity {
  workflowId: string;
  sequence: number;
  name: string;
  description?: string;
  action?: string;
  ownerId?: string;
  teamId?: string;
  conditions?: Record<string, unknown>;
}

// Responsibility (RACI assignment)
export interface Responsibility extends BaseEntity {
  ownerId: string;
  functionId?: string;
  activityId?: string;
  responsibilityType: ResponsibilityType;
}

// Valid values for enums
export const OWNER_TYPES: OwnerType[] = ['human', 'agent'];
export const ACTIVITY_STATUSES: ActivityStatus[] = ['pending', 'in_progress', 'completed', 'cancelled'];
export const WORKFLOW_STATUSES: WorkflowStatus[] = ['draft', 'active', 'paused', 'archived'];
export const TRIGGER_TYPES: TriggerType[] = ['manual', 'scheduled', 'event', 'condition'];
export const RESPONSIBILITY_TYPES: ResponsibilityType[] = ['owner', 'accountable', 'consulted', 'informed'];
