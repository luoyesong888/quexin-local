import AxeBuilder from '@axe-core/playwright'
import {expect,type Page,type TestInfo} from '@playwright/test'

const tags=['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22a','wcag22aa']

export async function checkA11y(page:Page,testInfo:TestInfo,name:string){
  const result=await new AxeBuilder({page}).withTags(tags).analyze()
  await testInfo.attach(`${name}-axe.json`,{body:JSON.stringify(result,null,2),contentType:'application/json'})
  const summary=result.violations.map(item=>`${item.impact??'unknown'} ${item.id}: ${item.nodes.map(node=>node.target.join(' > ')).join(', ')}`).join('\n')
  expect(result.violations,summary).toEqual([])
}

export async function openDemo(page:Page){
  await page.goto('/')
  await page.getByRole('button',{name:'先用虚构资料体验完整功能'}).click()
  await expect(page.locator('.app-shell')).toBeVisible()
}
