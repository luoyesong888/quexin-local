import {test,expect,type Page} from '@playwright/test'
import {themeOptions} from '../../src/domain'
import {readFile} from 'node:fs/promises'

async function demo(page:Page){
  await page.goto('/');await page.getByRole('button',{name:'先用虚构资料体验完整功能'}).click()
  await expect(page.getByRole('main')).toBeVisible()
  const toast=page.getByRole('button',{name:'关闭提示'});if(await toast.isVisible())await toast.click()
}
async function settings(page:Page){
  if(page.viewportSize()!.width<=720)await page.getByRole('button',{name:'打开我们的空间与设置'}).click()
  else await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:/系统/}).click()
}
async function home(page:Page){await page.getByRole('button',{name:/鹊信首页/}).filter({visible:true}).click()}
async function layout(page:Page){
  const overflow=await page.getByRole('main').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}))
  expect(overflow.scroll,'工作区不能裁掉横向内容').toBeLessThanOrEqual(overflow.width+1)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width)
  const broken=await page.locator('img:visible').evaluateAll(images=>images.filter(img=>(img as HTMLImageElement).complete&&!(img as HTMLImageElement).naturalWidth).map(img=>img.getAttribute('src')))
  expect(broken).toEqual([])
}

for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
  for(const theme of themeOptions){
    test(`${viewport.width} ${theme.id} 主题、首页、宠物和刷新`,async({page},testInfo)=>{
      await page.setViewportSize(viewport);await demo(page);await settings(page)
      await page.getByRole('button',{name:new RegExp(theme.name)}).click()
      await page.getByRole('checkbox',{name:'减少动态效果'}).check()
      await home(page);await expect(page.locator('.app-shell')).toHaveAttribute('data-theme',theme.id)
      await page.reload();await expect(page.locator('.app-shell')).toHaveAttribute('data-theme',theme.id)
      await layout(page);await page.screenshot({path:testInfo.outputPath('home.png'),animations:'disabled'})
      const nav=page.getByRole('navigation',{name:viewport.width<=720?'手机底部导航':'主导航'})
      await nav.getByRole('button',{name:/鹊巢/}).click()
      await expect(page.getByRole('heading',{name:'一起，把小日子养大。'})).toBeVisible()
      await layout(page)
      if(viewport.width===390){
        const action=await page.getByRole('button',{name:'摸摸',exact:true}).boundingBox(),area=await page.getByRole('main').boundingBox()
        expect(action!.y+action!.height,'照顾动作完整位于底部导航上方').toBeLessThanOrEqual(area!.y+area!.height)
      }
      const room=await page.locator('.life-room').boundingBox(),pet=await page.locator('.life-pet-sprite').boundingBox()
      expect(room&&pet).toBeTruthy();expect(pet!.x).toBeGreaterThanOrEqual(room!.x);expect(pet!.x+pet!.width).toBeLessThanOrEqual(room!.x+room!.width+1)
      expect(pet!.y).toBeGreaterThanOrEqual(room!.y);expect(pet!.y+pet!.height).toBeLessThanOrEqual(room!.y+room!.height+1)
      await page.screenshot({path:testInfo.outputPath('nest.png'),animations:'disabled'})
    })
  }
}

test('手机连续两次从记录入口写回忆，每次都打开编辑器',async({page})=>{
  await page.setViewportSize({width:390,height:844});await demo(page)
  for(let i=0;i<2;i++){
    await page.getByRole('button',{name:'记录一件事',exact:true}).click()
    await page.getByRole('button',{name:/写一段回忆/}).click()
    const dialog=page.getByRole('dialog',{name:'写下值得记住的事'});await expect(dialog).toBeVisible()
    await dialog.getByRole('button',{name:'取消',exact:true}).click()
  }
})

test('鹊巢时光胶囊入口直达胶囊分类',async({page})=>{
  await demo(page);await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:/鹊巢/}).click()
  await page.locator('.life-capsule-card').getByRole('button').click()
  await expect(page.getByRole('button',{name:'时光胶囊',exact:true})).toHaveClass(/active/)
})

for(const width of [390,1440])test(`${width} 青鸟统一聊天不裁切且只有一个输入框`,async({page},testInfo)=>{
  await page.setViewportSize({width,height:width===390?844:1000});await demo(page);const open=page.getByRole('button',{name:/展开青鸟助手|打开青鸟助手/});if(await open.isVisible())await open.click()
  const assistant=page.getByRole('complementary',{name:'青鸟助手'}),input=assistant.getByLabel('给青鸟输入指令');await expect(assistant).toContainText('直接告诉我，你想做什么。');await expect(input).toHaveCount(1)
  await input.fill('你可以做什么？');await assistant.getByRole('button',{name:'发送给青鸟'}).click();const reply=assistant.getByLabel('青鸟回复').last();await expect(reply).toContainText('记录、安排、整理和操作鹊信');expect(await reply.evaluate(element=>getComputedStyle(element).borderTopWidth)).toBe('0px')
  const headingBox=await assistant.locator('.assistant-heading').boundingBox(),chatBox=await assistant.locator('.assistant-chat').boundingBox(),userBox=await assistant.getByLabel('你的消息').last().boundingBox(),replyBox=await reply.boundingBox(),composerBox=await assistant.locator('.assistant-unified-composer').boundingBox();expect(headingBox&&chatBox&&userBox&&replyBox&&composerBox).toBeTruthy();expect(chatBox!.y).toBeGreaterThanOrEqual(headingBox!.y+headingBox!.height-1);expect(userBox!.y).toBeLessThan(replyBox!.y);expect(replyBox!.y+replyBox!.height).toBeLessThanOrEqual(composerBox!.y+1)
  expect(await assistant.evaluate(element=>element.scrollWidth<=element.clientWidth+1)).toBe(true);await page.screenshot({path:testInfo.outputPath('agent.png'),animations:'disabled'})
})

for(const width of [320,768,1920]){
  test(`${width} 八个页面及设置子页没有横向裁切`,async({page},testInfo)=>{
    await page.setViewportSize({width,height:width===320?740:1000});await demo(page)
    const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
    for(const route of ['today','import','memories','planner','care','nest','create','settings']){
      await page.goto('/#'+route);await expect(page.locator('.app-shell')).toBeVisible();await layout(page)
      await page.screenshot({path:testInfo.outputPath(route+'.png'),animations:'disabled'})
    }
    for(const label of ['空间与功能','数据与备份','操作记录']){
      await page.getByRole('button',{name:label,exact:true}).click();await layout(page)
    }
    expect(errors).toEqual([])
  })
}

test('手机创建计划和信件可重复打开，浏览器返回关闭表单',async({page})=>{
  await page.setViewportSize({width:390,height:844});await demo(page)
  for(const entry of [{name:/添加一件计划/,title:'一起期待的下一件事'},{name:/写一封信/,title:'新的信件'}]){
    for(let i=0;i<2;i++){
      await page.getByRole('button',{name:'记录一件事',exact:true}).click();await page.getByRole('dialog',{name:'记录一件事'}).getByRole('button',{name:entry.name}).click()
      await expect(page.getByRole('dialog',{name:entry.title})).toBeVisible();await page.getByRole('button',{name:'关闭弹窗'}).click()
    }
  }
  await home(page);await page.getByRole('button',{name:'记录一件事',exact:true}).click();await page.getByRole('button',{name:/添加一件计划/}).click()
  await page.goBack();await expect(page).toHaveURL(/#today$/);await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('heading',{name:/今天，想和/})).toBeVisible()
})

test('窄屏回忆保存编辑、空搜索与取消删除',async({page},testInfo)=>{
  await page.setViewportSize({width:320,height:740});await demo(page)
  await page.getByRole('navigation',{name:'手机底部导航'}).getByRole('button',{name:'回忆',exact:true}).click()
  await page.getByLabel('搜索回忆').fill('这里没有匹配的标题');await expect(page.getByText('还没有找到这段回忆，换个关键词试试。')).toBeVisible()
  await page.getByRole('button',{name:'清空搜索'}).click();await page.getByRole('button',{name:'写一条回忆',exact:true}).click()
  const form=page.getByRole('dialog');await form.getByLabel('标题',{exact:true}).fill('雨后的小花园');await form.getByLabel('内容',{exact:true}).fill('一起发现了一朵新开的花。')
  expect(await form.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true)
  await form.getByRole('button',{name:'保存记录'}).click();await page.getByLabel('搜索回忆').fill('雨后的小花园')
  await page.getByRole('main').getByRole('button',{name:/雨后的小花园/}).click();await page.getByRole('button',{name:'编辑记录',exact:true}).click()
  await page.getByRole('textbox',{name:'内容',exact:true}).fill('一起发现了两朵新开的花。');await page.getByRole('button',{name:'保存记录',exact:true}).click()
  await expect(page.getByRole('dialog')).toContainText('两朵');await page.getByRole('button',{name:'删除记录',exact:true}).click();await page.getByRole('button',{name:'保留记录'}).click()
  await page.getByRole('button',{name:'关闭弹窗'}).click();await page.reload();await page.getByLabel('搜索回忆').fill('雨后的小花园');await expect(page.getByRole('main')).toContainText('两朵')
  await page.screenshot({path:testInfo.outputPath('memory.png'),animations:'disabled'})
})

test('宠物四种姿态、房间和改名在手机保留，动作首屏可见',async({page},testInfo)=>{
  await page.setViewportSize({width:390,height:844});await demo(page)
  await page.getByRole('navigation',{name:'手机底部导航'}).getByRole('button',{name:'鹊巢',exact:true}).click()
  await expect(page.getByRole('button',{name:'摸摸',exact:true})).toBeInViewport()
  for(const [name,pose] of [['摸摸','happy'],['喂点心','eat'],['休息','sleep'],['唤醒','idle']]){
    await page.getByRole('button',{name,exact:true}).click();await expect(page.locator('.life-pet-sprite')).toHaveClass(new RegExp('pose-'+pose))
  }
  await page.getByRole('button',{name:'布置',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:/庭院春深/}).click()
  await expect(page.locator('.life-room')).toHaveClass(/room-garden/)
  await page.getByRole('button',{name:'给小鹊改名'}).click();await page.getByLabel('小伙伴的名字').fill('小青');await page.getByRole('button',{name:'就叫这个名字'}).click()
  await expect(page.getByRole('heading',{name:'小青的小小世界'})).toBeVisible()
  await expect(page.locator('.topbar .top-status').first()).toContainText('IndexedDB 已就绪')
  await page.reload();await expect(page.getByRole('heading',{name:'小青的小小世界'})).toBeVisible();await expect(page.locator('.life-room')).toHaveClass(/room-garden/)
  await page.screenshot({path:testInfo.outputPath('nest-actions.png'),animations:'disabled'})
})

test('桌面弹窗键盘退出并返回触发按钮，助手平板导航退出覆盖层',async({page})=>{
  await demo(page);const guide=page.getByRole('button',{name:'查看演示指引'});await guide.click()
  await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(guide).toBeFocused()
  await page.setViewportSize({width:768,height:1024})
  const assistant=page.getByRole('complementary',{name:'青鸟助手'});if(!await assistant.isVisible())await page.getByRole('button',{name:'展开青鸟助手'}).click()
  await expect(assistant.getByLabel('给青鸟输入指令')).toBeVisible();await assistant.getByRole('button',{name:'关闭青鸟助手'}).click();await expect(assistant).not.toBeVisible();await page.getByRole('button',{name:'展开青鸟助手'}).click();await assistant.getByRole('button',{name:'添加图片、文件或录音'}).click();await assistant.getByRole('button',{name:'粘贴文字',exact:true}).click();await expect(page).toHaveURL(/#import$/);await expect(page.getByLabel('想整理的内容',{exact:true})).toBeVisible()
})

test('空空间和无效备份提供可恢复的提示',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');await page.getByLabel('怎么称呼你').fill('阿澄');await page.getByLabel('怎么称呼对方').fill('小满');await page.getByRole('button',{name:'创建我们的空间'}).click()
  await expect(page.getByRole('heading',{name:'普通的一天，也值得记住。'})).toBeVisible();await page.getByRole('navigation',{name:'手机底部导航'}).getByRole('button',{name:'回忆',exact:true}).click()
  await expect(page.getByText('我们的故事，从第一条记录开始。')).toBeVisible()
  await settings(page);await page.getByRole('button',{name:'数据与备份',exact:true}).click()
  await page.getByLabel('选择 JSON 备份文件').setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from('{wrong')})
  await expect(page.getByRole('status').filter({hasText:'文件不是有效的鹊信备份'})).toBeVisible();await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('navigation',{name:'手机底部导航'}).getByRole('button',{name:'回忆',exact:true}).click();await expect(page.getByText('我们的故事，从第一条记录开始。')).toBeVisible()
})

test('手机关怀入口保存私人草稿、本机分享边界和日历安排',async({page})=>{
  await page.setViewportSize({width:390,height:844});await demo(page)
  await page.getByRole('button',{name:'记录一件事',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:/说说今天的需要/}).click()
  await page.getByRole('button',{name:/想被听见 陪我说/}).click();await expect(page.getByText(/登录并加入共同空间后/)).toBeVisible()
  await page.getByRole('textbox',{name:'发生了什么？我希望被怎样对待？'}).fill('想慢慢说完今天的故事。');await page.getByRole('button',{name:'保存私人草稿',exact:true}).click()
  await expect(page.getByRole('button',{name:'更新私人草稿',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'安排一份关心',exact:true}).click();await page.getByRole('textbox',{name:'想做的事',exact:true}).fill('周末带一束小花');await page.getByRole('button',{name:'加入日历',exact:true}).click()
  await page.getByRole('navigation',{name:'手机底部导航'}).getByRole('button',{name:'日程',exact:true}).click()
  const plan=page.getByRole('article').filter({hasText:'周末带一束小花'});await expect(plan).toBeVisible()
  await plan.getByRole('button',{name:'编辑',exact:true}).click();await page.getByRole('textbox',{name:'想做什么'}).fill('周末带两束小花');await page.getByRole('button',{name:'保存安排',exact:true}).click()
  const changed=page.getByRole('article').filter({hasText:'周末带两束小花'});await changed.getByRole('button',{name:'取消安排',exact:true}).click();await changed.getByRole('button',{name:'保留',exact:true}).click()
  await changed.getByRole('button',{name:/完成周末带两束小花/}).click();await expect(changed).toContainText('已完成');await changed.getByRole('button',{name:/将周末带两束小花.*恢复为待完成/}).click()
  await expect(changed).not.toContainText('已完成')
})

test('创作信件编辑、安全胶囊边界和离线导出保留实际状态',async({page})=>{
  await demo(page);await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:/创作/}).click()
  await page.getByRole('button',{name:'写一封信',exact:true}).click();await page.getByRole('textbox',{name:'标题',exact:true}).fill('给明天的你');await page.getByRole('textbox',{name:'想说的话',exact:true}).fill('一起慢慢走。');await page.getByRole('button',{name:'保存这份心意'}).click()
  const letter=page.getByRole('article').filter({hasText:'给明天的你'});await letter.getByRole('button',{name:'继续编辑'}).click();await page.getByRole('textbox',{name:'想说的话',exact:true}).fill('一起慢慢走，看看沿途的花。');await page.getByRole('button',{name:'保存这份心意'}).click()
  await letter.getByRole('button',{name:'打开阅读'}).click();await expect(page.getByRole('dialog')).toContainText('沿途的花');await page.getByRole('button',{name:'收好',exact:true}).click()
  await page.getByRole('button',{name:'时光胶囊',exact:true}).click();await page.getByRole('button',{name:'写安全时光胶囊',exact:true}).click();await page.getByRole('textbox',{name:'标题',exact:true}).fill('给未来的暗号');await page.getByRole('textbox',{name:'想说的话',exact:true}).fill('CAPSULE_PRIVATE_BODY_VISUAL_QA');await page.getByRole('button',{name:'封存这份心意'}).click()
  await expect(page.getByText('安全封存需要先登录并加入共同空间；正文仍留在编辑器中。')).toBeVisible();await expect(page.getByRole('dialog',{name:'新的时光胶囊'})).toContainText('CAPSULE_PRIVATE_BODY_VISUAL_QA');await page.getByRole('button',{name:'关闭弹窗'}).click();await expect(page.getByRole('article').filter({hasText:'给未来的暗号'})).toHaveCount(0)
  const legacy=page.getByRole('article').filter({hasText:'留给一年后的我们'});await legacy.getByRole('button',{name:'查看胶囊'}).click();await expect(page.getByRole('dialog')).toContainText('旧版本地胶囊');await expect(page.getByRole('dialog')).not.toContainText('CAPSULE_PRIVATE_BODY_VISUAL_QA')
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'导出不含正文的封面'}).click();const download=await downloading;const html=await readFile((await download.path())!,'utf8');expect(html).toContain('留给一年后的我们');expect(html).not.toContain('CAPSULE_PRIVATE_BODY_VISUAL_QA')
  await page.getByRole('button',{name:'收好',exact:true}).click();await page.getByRole('button',{name:'年度回顾',exact:true}).click();await page.getByRole('button',{name:'从已确认回忆生成'}).click()
  await expect(page.getByRole('dialog',{name:'新的年度回顾'})).toBeVisible();await expect(page.getByRole('textbox',{name:'想说的话',exact:true})).toHaveValue(/认真记住/)
})
