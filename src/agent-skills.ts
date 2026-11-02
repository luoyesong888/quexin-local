import catalog from '../skills/qingniao-agent/assets/catalog.json'

export type AgentSkillId='command-inbox'|'personal-memory'|'personal-planner'|'personal-journal'|'discover-imports'|'image-to-memory-plan'|'plan-follow-up'|'calendar-draft'|'email-draft'|'relationship-review'
export type AgentRisk='L0'|'L1'|'L2'|'L3'
export type ProductToolId='open-page'|'pet-touch'|'pet-feed'|'pet-rest'|'pet-wake'|'change-theme'|'toggle-care'|'toggle-pet'|'export-backup'|'export-museum'
export type AgentProposalKind='memory_draft'|'plan_draft'|'journal_draft'|'care_draft'|'calendar_draft'|'email_draft'|'product_action'
export type AgentProposalFields={title?:string;body?:string;date?:string;time?:string;recordKind?:'回忆'|'心愿'|'计划'|'偏好';planKind?:'心愿'|'计划'|'待办'|'提醒'|'纪念日';journalType?:'信件'|'日常'|'年度回顾';recurrence?:'none'|'daily'|'weekly'|'monthly'|'yearly';recurrenceUntil?:string;reminderMinutes?:number;careNeed?:'想安静'|'想聊聊'|'想被听见'|'一起想办法';description?:string;subject?:string;recipient?:string;productTool?:ProductToolId;toolTarget?:string;toolValue?:string}
export type AgentProposal={id:string;kind:AgentProposalKind;title:string;riskLevel:AgentRisk;sourceIds:string[];fields:AgentProposalFields;status:'pending'|'approved'|'rejected'|'failed';result?:string}
export type AgentStep={id:string;skillId:AgentSkillId;title:string;reason:string;status:'ready'|'completed'|'blocked'}
export type AgentTurn={role:'user'|'assistant';text:string;at:string}
export type AgentRun={id:string;goal:string;mode:'command'|'discover'|'image'|'followup'|'review'|'custom';status:'awaiting_approval'|'needs_input'|'completed'|'failed'|'cancelled';selectedSkills:AgentSkillId[];summary:string;steps:AgentStep[];sourceIds:string[];proposals:AgentProposal[];followUpQuestion:string;uncertainty:string;conversation:AgentTurn[];createdAt:string;updatedAt:string}
export type AgentSkill={id:AgentSkillId;name:string;description:string;risk:AgentRisk;inputs:string[];outputs:string[]}
export type AgentCapabilityGate={id:string;name:string;enabled:boolean;requiredCapability:string;reason:string}
export type ProductTool={id:ProductToolId;name:string;risk:AgentRisk;description:string}
export type AssistantChatOperation='question'|'agent-discover'|'agent-followup'|'agent-review'|'agent-custom'
export type AssistantChatMessage={id:string;role:'user'|'assistant'|'system';kind:'text'|'attachment'|'source_scope'|'agent_run'|'tool_result'|'error';text:string;createdAt:string;status?:'pending'|'running'|'completed'|'failed'|'cancelled';runId?:string;sourceIds?:string[];planIds?:string[];citationIds?:string[];suggestedCommands?:string[];operation?:AssistantChatOperation;query?:string;attachmentName?:string}

export const agentSkills=(catalog.skills as AgentSkill[])
export const agentSkillIds=agentSkills.map(skill=>skill.id)
export const agentSkillName=(id:AgentSkillId)=>agentSkills.find(skill=>skill.id===id)?.name??id
export const agentCapabilityGates=(catalog.capabilityGates as AgentCapabilityGate[])
export const productTools=(catalog.productTools as ProductTool[])
export const productToolIds=productTools.map(tool=>tool.id)
export const productToolName=(id:ProductToolId)=>productTools.find(tool=>tool.id===id)?.name??id
