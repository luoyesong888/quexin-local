import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {agentSkillIds,productToolIds} from '../server/lib/assistant-provider.mjs'

test('青鸟 Agent Skill 包符合目录规范且运行时白名单与目录一致',async()=>{
 const root='skills/qingniao-agent',skill=await readFile(`${root}/SKILL.md`,'utf8'),catalog=JSON.parse(await readFile(`${root}/assets/catalog.json`,'utf8')),ui=await readFile(`${root}/agents/openai.yaml`,'utf8'),workflows=await readFile(`${root}/references/workflows.md`,'utf8'),privacy=await readFile(`${root}/references/privacy-and-approval.md`,'utf8'),folderTask=await readFile(`${root}/assets/workbuddy-chat-folder-task.md`,'utf8')
 assert.match(skill,/^---\nname: qingniao-agent\ndescription: .+\n---/);assert.match(skill,/references\/workflows\.md/);assert.match(skill,/privacy-and-approval\.md/);assert.match(skill,/workbuddy-chat-folder-task\.md/);assert.match(folderTask,/workbuddy-chat-bridge\.mjs convert/);assert.match(ui,/allow_implicit_invocation: true/)
 assert.equal(catalog.format,'quexin-agent-skills-v1');assert.equal(catalog.skills.length,10);assert.deepEqual(catalog.skills.map(skill=>skill.id),agentSkillIds);assert.equal(new Set(catalog.skills.map(skill=>skill.id)).size,catalog.skills.length);assert.deepEqual(catalog.capabilityGates,[{id:'wechat-chat-import',name:'微信聊天提取',enabled:false,requiredCapability:'verified-workbuddy-chat-extractor',reason:'尚未检测到经过来源、权限和失败回退验收的 WorkBuddy 聊天提取适配器。'}]);assert.equal(agentSkillIds.includes('wechat-chat-import'),false);assert.deepEqual(catalog.productTools.map(tool=>tool.id),productToolIds);assert.equal(catalog.productTools.length,10)
 for(const id of agentSkillIds){assert.match(workflows,new RegExp('`'+id+'`'));assert.match(skill+privacy,/审批|approval/i)}
})
