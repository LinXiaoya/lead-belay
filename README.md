# 先锋保护员

一个无依赖、可直接在手机浏览器运行的先锋保护小游戏。页面文件位于：

- `/Users/daiga/Documents/lead-belay/index.html`
- `/Users/daiga/Documents/lead-belay/styles.css`
- `/Users/daiga/Documents/lead-belay/game.js`

## 操作

- `A / D`：首挂前左右调整站位；首挂后前移 / 后移
- `W / S`：放绳 / 收绳
- `Space`：首挂前抱石保护；冲坠时动态跳起
- 手机触屏：
  - 左侧摇杆：左 / 右滑控制站位，上滑给绳，下滑收绳
  - 右侧按键：起跳 / 抱石保护

## 机制摘要

- 首挂前只做抱石保护，第一把快挂自动完成以进入先锋保护阶段。
- 首挂完成后默认会带着约 `2 m` 余绳进入低位保护，低位阶段允许随机冲坠。
- 首挂后用 `manualRope` 追踪系统总绳长，绳路按 `保护员 -> 已入挂快挂链 -> 攀爬者` 计算。
- 入挂阶段要求额外给出约 `1 m` 绳环让攀爬者抽绳入挂；入挂完成后，这段余绳会暂时垂在攀爬者一侧，并继续计入系统总余绳。
- 正常攀爬时，新给出的余绳会优先堆在保护员这一侧；攀爬者侧只保留少量运行余量。余绳过多时，第一把快挂到保护员之间会以弧线耷拉到地面。
- 冲坠时使用自定义弹簧阻尼模型：
  - 固定绳路长度 = `保护员到最后一把已挂快挂的折线路径`
  - 系统会把总余绳拆成 `攀爬者侧运行余量 + 保护员侧地面余绳`
  - 冲坠时默认只有一部分保护员侧余绳会因为快挂和鞋底摩擦而顺过去，所以原地硬接更容易产生高冲击力
  - 冲坠前通过前移 / 后移改变站位，会直接改变绳子开始吃力时的有效绳长
  - 在绳子开始吃力的窗口内起跳，会把更多保护员侧余绳送出，并把保护员拉向第一把快挂
  - 峰值张力换算为冲击力，过高则判定为保护过硬
- 随机冲坠频率已压到完整一趟大约 `3-5` 次，更接近教学练习时的节奏。
- 教学向判负阈值：
  - 在第 `3` 把快挂完成之前，低位保护只判定是否坠地，不因为“接坠过硬”直接失败。
  - 第 `3` 把快挂完成后，如果峰值冲击力超过 `4.5 kN`，会判定为“保护过硬”失败。这是为了提高游戏难度而采用的教学向保守阈值，不是正式训练标准。

## 说明

这是一个教学向简化模拟，不替代真实先锋保护训练或教学。

## 验证

- 语法检查：
  - `node --check game.js`
- 自动化回归：
  - `python3 scripts/validate_game.py`
  - 可选单独指定种子：`python3 scripts/validate_game.py --seed alpha --seed beta`

## 资料来源

- Petzl: `Belaying a leader`
  - https://www.petzl.com/US/en/Sport/Belaying-a-leader
- Petzl: `The danger of a ground fall in a lead climbing fall`
  - https://www.petzl.com/US/en/Sport/Dangers-ground-fall-lead-climbing
- Petzl: `Belayer position relative to the first bolt in lead climbing`
  - https://www.petzl.com/US/en/Sport/Belayer-position-relative-to-the-first-bolt-in-lead-climbing
- REI Expert Advice: `Lead Belaying Basics`
  - https://www.rei.com/learn/expert-advice/lead-belaying.html
- Cornell Outdoor Education: `How to Spot a Climber`
  - https://scl.cornell.edu/coe/outdoor-education/climbing/how-spot-climber
