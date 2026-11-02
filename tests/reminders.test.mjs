import test from 'node:test'
import assert from 'node:assert/strict'
import {recurrenceDates,zonedDateTimeEpoch,reminderOccurrences,validTimeZone} from '../shared/reminders.mjs'
const plan={id:'p',title:'重复安排',date:'2024-01-31',time:'09:00',kind:'提醒',status:'todo',timezone:'Asia/Shanghai',recurrence:'monthly',reminderMinutes:10,completedOccurrences:[]}
test('月底重复跳过不存在日期，不漂移到下个月',()=>{assert.deepEqual(recurrenceDates(plan,'2024-01-01','2024-05-31'),['2024-01-31','2024-03-31','2024-05-31'])})
test('闰日按年重复只出现在有效年份',()=>{assert.deepEqual(recurrenceDates({...plan,date:'2024-02-29',recurrence:'yearly'},'2024-01-01','2030-12-31'),['2024-02-29','2028-02-29'])})
test('时区转换识别夏令时不存在时间并区分同时刻',()=>{assert.equal(validTimeZone('Asia/Shanghai'),true);assert.equal(validTimeZone('Bad/Zone'),false);assert.ok(Number.isNaN(zonedDateTimeEpoch('2026-03-08','02:30','America/New_York')));assert.notEqual(zonedDateTimeEpoch('2026-01-10','09:00','Asia/Shanghai'),zonedDateTimeEpoch('2026-01-10','09:00','Europe/London'))})
test('提醒只在窗口内生成，完成和取消计划不提醒',()=>{const event=zonedDateTimeEpoch('2026-10-31','09:00','Asia/Shanghai'),current={...plan,date:'2026-10-31',recurrence:'none'};assert.equal(reminderOccurrences(current,event-20*60000).length,0);assert.equal(reminderOccurrences(current,event-5*60000).length,1);assert.equal(reminderOccurrences({...current,status:'done'},event).length,0);assert.equal(reminderOccurrences({...current,status:'cancelled'},event).length,0);assert.equal(reminderOccurrences({...current,recurrence:'weekly',completedOccurrences:['2026-10-31']},event).length,0)})
