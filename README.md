# To-do list 项目说明

这是一个离线优先的个人效率应用，包含日程、待办、记账、专注和打卡功能。项目同时支持浏览器/PWA 运行，以及通过 `android-webview-app` 打包成 Android APK。

## 目录结构

- `index.html`：Web 应用入口页面。
- `style.css`：全部界面样式和移动端适配。
- `app.js`：核心业务逻辑，包括数据存储、日程、待办、记账、打卡、导入导出等。
- `manifest.json`：PWA 配置。
- `service-worker.js`：离线缓存逻辑。
- `logo.png`：应用图标。
- `android-webview-app/`：Android WebView 外壳工程。
- `android-webview-app/app/src/main/assets/www/`：APK 内置的 Web 资源副本。发布 APK 前需要和根目录 Web 文件保持一致。
- `android-webview-app/app/src/main/java/.../MainActivity.kt`：Android 原生 WebView、文件选择器、系统日历读取桥接。

## 本地运行 Web 版

可以直接用浏览器打开 `index.html`。如果要测试 PWA、Service Worker 或移动端缓存行为，建议启动一个本地静态服务器：

```bash
python3 -m http.server 8080
```

然后访问：

```text
http://localhost:8080
```

## Android 安装和打包

打包前需要安装 Java JDK 和 Android SDK。macOS 上如果执行 Gradle 时提示无法找到 Java Runtime，请先安装 JDK，再重新打开终端。

进入 Android 工程目录：

```bash
cd android-webview-app
./gradlew assembleDebug
```

生成的调试 APK 位于：

```text
android-webview-app/app/build/outputs/apk/debug/app-debug.apk
```

安装到已连接手机：

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

如果手机上已有旧版本，`-r` 会覆盖安装并尽量保留应用数据。

## 更新应用代码

根目录的 `index.html`、`style.css`、`app.js`、`manifest.json`、`service-worker.js`、`logo.png` 是 Web 主副本。Android APK 使用 `android-webview-app/app/src/main/assets/www/` 里的副本。

更新流程：

1. 修改根目录 Web 文件。
2. 在浏览器中测试功能。
3. 同步到 Android assets：

```bash
cp index.html style.css app.js manifest.json service-worker.js logo.png android-webview-app/app/src/main/assets/www/
```

4. 重新打包 APK：

```bash
cd android-webview-app
./gradlew assembleDebug
```

5. 安装新 APK：

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## 数据保存位置

应用数据保存在浏览器或 Android WebView 的 `localStorage` 中，不依赖服务器。

主要键名：

- `to-list-pro-data`：待办事项和日程安排。
- `to-list-pro-finances`：记账数据。
- `to-list-pro-checkmarks`：打卡项目和记录。
- `to-list-pro-tags`：自定义标签。
- `to-list-pro-finance-categories`：记账分类。
- `to-list-pro-focus-records`：专注记录。

Android 上这些数据属于当前应用包名，覆盖安装通常会保留，卸载应用会删除。

## 导出现有数据

在应用内操作：

1. 打开「设置」。
2. 点击「导出全部数据」。
3. 系统会下载一个 JSON 备份文件。
4. 妥善保存该 JSON 文件，它包含待办、日程、记账、打卡、标签、分类和专注记录。

备份文件适合在更新 APK、换手机或清空数据前保存。

## 导入备份数据

在应用内操作：

1. 打开「设置」。
2. 点击「导入数据备份」。
3. 选择之前导出的 `.json` 文件。
4. 应用会读取备份并覆盖当前本地数据。

导入前建议先导出一次当前数据，避免误覆盖。

## 同步系统日历

Android APK 中可以读取系统日历：

1. 打开「设置」。
2. 点击「同步系统日历」。
3. 首次使用时允许读取日历权限。
4. 同步后的系统事件会进入日程时间轴，并带有 `android-calendar` 来源标记。

注意：

- 浏览器版无法读取系统日历，需要安装 APK。
- 华为/鸿蒙设备需要在系统设置里确认本应用拥有「读取日历」权限。
- 同步逻辑会避免重复导入同一系统日历事件。

## 导入华为日历 ICS

如果系统日历同步不可用，可以使用华为日历导出的 `.ics` 文件：

1. 从华为日历导出 `.ics` 或 `.ical` 文件。
2. 打开应用「设置」。
3. 点击「导入华为日历」。
4. 选择日历文件。

导入成功后，事件会显示在日程时间轴和日历面板中。

## 清除数据

在「设置」中点击「清除所有数据」可以清空本地存储。该操作不可撤销，执行前请先导出备份。

## 常见问题

### 更新 APK 后数据还在吗？

使用相同包名覆盖安装时，Android 通常会保留 WebView localStorage。卸载后重装会清空数据，所以卸载前必须导出备份。

### 为什么浏览器能用，APK 没更新？

Android APK 读取的是 `android-webview-app/app/src/main/assets/www/` 里的文件。修改根目录文件后，需要复制到 assets 并重新打包。

### 为什么 PWA 离线缓存不更新？

浏览器可能仍在使用旧 Service Worker 缓存。可以在开发者工具里清除站点数据，或修改 `service-worker.js` 的 `CACHE_NAME` 后重新加载。

### 日历里部分事项不能编辑怎么办？

当前版本已经修复特殊字符导致编辑弹窗结构损坏的问题。如果仍有异常，先导出数据备份，再检查对应事项标题或地点是否包含非常规字符。

## 维护建议

- 不要提交或保存 `android-webview-app/app/build/` 与 `android-webview-app/.gradle/`，它们是可再生成的构建缓存。
- 修改 Web 主副本后，记得同步 Android assets。
- 每次发布 APK 前，至少验证：新增待办、编辑待办、待办列表滚动、日历面板编辑、新增日程、导出备份、导入备份。
