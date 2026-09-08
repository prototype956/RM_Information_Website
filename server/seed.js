import fs from 'node:fs';
import path from 'node:path';

// All seeded entries are clearly marked examples. No team results are fabricated.
export function seedResources(db, adminId, fileDir) {
  const now = Date.now();
  const entries = [
    ['高等数学 · 微积分复习提纲', 'academic', '高等数学', ['期末复习', '大一', '知识梳理'], 'file', '', '一份用于体验预览与下载的示例资料，列出微积分复习的基础结构。正式使用时请替换为队内资料。'],
    ['STM32 开发入门与外设基础', 'rm', '电控与嵌入式', ['STM32', '入门', '开发文档'], 'link', 'https://www.st.com/en/microcontrollers-microprocessors/stm32-32-bit-arm-cortex-mcus.html', 'STM32 官方产品与开发资源入口，适合查阅芯片系列及开发资料。'],
    ['OpenCV · 从图像到视觉识别', 'rm', '视觉算法', ['OpenCV', '计算机视觉', '进阶'], 'link', 'https://docs.opencv.org/4.x/', 'OpenCV 官方文档入口。可结合队内视觉训练内容学习图像处理、标定和特征提取。'],
    ['线性代数 · 核心知识清单', 'academic', '线性代数', ['期末复习', '大一', '知识梳理'], 'file', '', '矩阵、线性方程组、特征值与二次型的复习目录示例。请结合实际教学内容使用。'],
    ['机器人底盘 · 结构示意图', 'rm', '机械', ['底盘', '结构设计', '入门'], 'file', '', '用于演示图片预览的原创简化结构示意图，不是实物加工图纸。'],
    ['RoboMaster · 赛事资料入口', 'rm', '赛事规则', ['赛事规则', '官方资源'], 'link', 'https://www.robomaster.com/zh-CN', 'RoboMaster 官方网站入口。规则版本请以官方当前发布内容为准。'],
    ['大学物理 · 复习导航', 'academic', '大学物理', ['期末复习', '大一'], 'file', '', '力学、电磁学与波动光学的目录示例，便于体验分类与收藏功能。'],
    ['ROS 2 · 自主导航学习起点', 'rm', '自主导航', ['ROS 2', '导航', '入门'], 'link', 'https://docs.ros.org/', 'ROS 官方文档入口，可按队内使用版本选择对应文档。'],
    ['Git · 团队协作参考手册', 'rm', '通用工具', ['Git', '团队协作'], 'link', 'https://git-scm.com/book/zh/v2', 'Pro Git 中文在线书籍入口，适合学习版本管理与团队协作。']
  ];
  const insert = db.prepare('INSERT INTO resources (id,title,domain,category,tags,kind,url,description,owner_id,created_at,updated_at,sample) VALUES (?,?,?,?,?,?,?,?,?,?,?,1)');
  entries.forEach((e, i) => {
    const id = `sample-${i + 1}`;
    insert.run(id, e[0], e[1], e[2], JSON.stringify(e[3]), e[4], e[5], e[6], adminId, now - i * 3600000, now - i * 3600000);
    if (e[4] !== 'file') return;
    const image = i === 4;
    const key = `example-${i}.${image ? 'svg' : 'txt'}`;
    const content = image ? `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600" viewBox="0 0 900 600"><rect width="900" height="600" fill="#111c17"/><g fill="none" stroke="#63f59a" stroke-width="3"><path d="M200 330 480 175 725 300 435 470Z M200 330v45l235 140 290-170v-45 M435 470v45 M280 310 480 200 640 290 435 415Z"/><path d="M450 230v-70l65-35 60 35v105 M475 145l40 20 60-5 M515 165v100"/><ellipse cx="275" cy="411" rx="28" ry="48" transform="rotate(-30 275 411)"/><ellipse cx="640" cy="417" rx="28" ry="48" transform="rotate(30 640 417)"/></g><text x="45" y="65" fill="#e6eee8" font-family="sans-serif" font-size="25">RM CHASSIS / STRUCTURE STUDY</text><text x="45" y="555" fill="#97aca1" font-family="sans-serif" font-size="18">EXAMPLE ONLY - NOT FOR MANUFACTURING</text></svg>` : `【示例资料】${e[0]}\n\n${e[6]}\n\n一、建立知识框架\n二、整理基础概念\n三、练习典型问题\n四、记录错题与回顾\n\n本文件仅用于验证上传、阅读与下载流程，不是正式教学资料。\n`;
    fs.writeFileSync(path.join(fileDir, key), content);
    db.prepare('INSERT INTO attachments (id,resource_id,storage_key,name,mime,size) VALUES (?,?,?,?,?,?)').run(`attachment-${i}`, id, key, `${e[0]}.${image ? 'svg' : 'txt'}`, image ? 'image/svg+xml' : 'text/plain', Buffer.byteLength(content));
  });
}
