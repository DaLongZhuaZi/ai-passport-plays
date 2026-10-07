# AI Passport 玩法库

为 **FoloToy AI Passport**（ESP32-C3）收集的社区玩法库：一个静态网页 + 一个固件仓库。
打开网页，点任意玩法的「安装」，用数据线连上设备，就能直接在浏览器里刷入，不用装任何软件。

🌐 在线访问：https://dalongzhuazi.github.io/ai-passport-plays/

## 玩法一览

| 玩法 | 作者 | 说明 |
| --- | --- | --- |
| 赛博六爻 CyberYAO | XadillaX | 完全离线的六爻占卜 + 古风待机时钟，全 64 卦 / 384 爻辞内置 |
| 蓝牙对讲机 Intercom | Shinku-Chen | 两台 Passport 通过 BLE 变成一对对讲机 |
| 四子棋 Connect Four | Shinku-Chen | 经典四子棋对弈小游戏 |

## 安全设计（为什么这样刷不会变砖）

- 官方分区：factory 应用区 3MB（0x10000 起）、cardid 设备身份区在 0x356000、Recovery 在 0x700000。
- 本站的安装器 **只把玩法的应用镜像写到 0x10000**，不写 bootloader、不写分区表、不碰 NVS、cardid 和 Recovery。
- 装完不满意：关机后**长按 UP 开机**进 Recovery，用 FoloToy 官方小程序就能装回官方玩法。
- 每个固件在 `manifest.json` 里记录了 SHA-256，网页在刷机前会先校验下载到的文件与清单一致，不一致直接中止。

### 为什么有些社区固件没收录

部分社区固件发布的是「整片 8MB 镜像」（如音效钥匙扣的全量包），从 0x0 整体烧录会覆盖 cardid 与 Recovery 区，属于不可逆操作，本站不收录这类刷写方式。只收录能以「应用镜像 @ 0x10000」安全安装的玩法。

## 仓库结构

```
index.html              网站首页（GitHub Pages）
assets/                 样式、前端逻辑、内置的 esptool-js 刷机库
manifest.json           玩法清单（由脚本生成，不要手改）
plays/<id>/
  play.json             元数据：名称、版本、作者、描述、标签、来源、许可
  firmware.bin          应用镜像（刷写到 0x10000，≤ 3MB）
  cover.jpg             封面（3:4）
tools/build_manifest.py 重新生成 manifest.json 并做镜像合法性检查
```

## 添加新玩法

1. 在 `plays/` 下新建目录，放好 `play.json`、`firmware.bin`、`cover.jpg`；
   `firmware.bin` 必须是 ESP 应用镜像（首字节 0xE9），且不超过 3MB。
   如果来源是「合并镜像（merged/full.bin）」，取其中从 0x10000 起的应用段即可（前提是该玩法不依赖自定义分区表与额外数据分区）。
2. 运行 `python3 tools/build_manifest.py` 重新生成清单（会校验镜像并计算 SHA-256）。
3. 提交推送，GitHub Pages 会自动更新。

## 版权与许可

- 本仓库的网站代码与脚本为自用整理；各玩法的固件版权归其原作者所有，均为 MIT 许可，来源链接见每张卡片与 `play.json`。
- 刷机库 [esptool-js](https://github.com/espressif/esptool-js)（Apache-2.0，乐鑫官方）内置于 `assets/vendor/`，方便国内访问。
- 本站与 FoloToy 官方无关，是个人玩家的自建玩法库。
