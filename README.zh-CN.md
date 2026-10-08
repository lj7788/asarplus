# asarpro — Electron 归档工具

[![Test](https://github.com/lj7788/asarpro/actions/workflows/test.yml/badge.svg)](https://github.com/lj7788/asarpro/actions/workflows/test.yml)
[![npm version](http://img.shields.io/npm/v/asarpro.svg)](https://npmjs.org/package/asarpro)

[English](./README.md) | 简体中文

ASAR 是一种简单紧凑的归档格式。它把所有文件无压缩地拼接在一起（类似
[`tar`](https://www.gnu.org/software/tar/)），同时支持随机访问。

## 特性

* 支持随机访问
* 使用 JSON 存储文件信息
* 解析器非常容易编写
* 内容相同的文件只存储一份（去重）

## 命令行

### 安装

需要 Node.js 22.12.0 或更高版本。

```bash
npm i -g asarpro
```

安装后提供 `asarpro` 命令。

### 用法

```bash
$ asarpro --help

  Usage: asarpro [options] [command]

  Commands:

    pack|p <dir> <output>
       create asar archive

    list|l <archive>
       list files of asar archive

    extract-file|ef <archive> <filename>
       extract one file from archive

    extract|e <archive> <dest>
       extract archive

    replace|r <archive> <filename> <source>
       replace a file inside archive with contents of source file


  Options:

    -h, --help     output usage information
    -V, --version  output the version number

```

#### 打包（pack）

```bash
asarpro pack app app.asar

# 匹配 glob 的文件不打包进归档，而是放在归档旁边的 app.asar.unpacked/ 目录下
asarpro pack app app.asar --unpack "*.node"

# 排除隐藏文件
asarpro pack app app.asar --exclude-hidden

# 控制文件在归档中的存放顺序（某些场景下可加快应用启动）
asarpro pack app app.asar --ordering order.txt
```

##### 排除多个资源不打包

给定目录：

```text
    app
(a) ├── x1
(b) ├── x2
(c) ├── y3
(d) │   ├── x1
(e) │   └── z1
(f) │       └── x2
(g) └── z4
(h)     └── w1
```

排除：a、b

```bash
asarpro pack app app.asar --unpack-dir "{x1,x2}"
```

排除：a、b、d、f

```bash
asarpro pack app app.asar --unpack-dir "**/{x1,x2}"
```

排除：a、b、d、f、h

```bash
asarpro pack app app.asar --unpack-dir "{**/x1,**/x2,z4/w1}"
```

#### 列出文件（list）

```bash
asarpro list app.asar

# 同时显示每个条目是打包（pack）还是未打包（unpack）
asarpro list --is-pack app.asar
```

```text
pack   : /a.txt
pack   : /sub
unpack : /sub/b.bin
```

#### 解包（extract）

```bash
# 把整个归档解包到 ./dest 目录
asarpro extract app.asar dest

# 只解出单个文件，写入当前目录，文件名取路径的最后一段
asarpro extract-file app.asar path/inside/b.bin   # -> ./b.bin
```

#### 替换归档内的文件（replace）

```bash
asarpro replace app.asar path/inside/archive.js new-file.js
```

新内容会追加到归档数据段的末尾，并把对应条目重新指向新位置，因此归档的
其余部分完全不受影响（包括因去重而共享内容的条目）。旧字节会残留为空洞，
直到用 `asarpro pack` 重新打包归档。

## 编程方式使用

完整 API 说明见 [API 文档](https://github.com/lj7788/asarpro)。

| 函数 | 说明 |
| --- | --- |
| `createPackage(src, dest)` | 把目录 `src` 打包为归档 `dest` |
| `createPackageWithOptions(src, dest, options)` | 打包，支持 `unpack`、`unpackDir`、`ordering`、`pattern`、`transform`、`dot` / `globOptions` 选项 |
| `createPackageFromFiles(src, dest, filenames, metadata?)` | 打包一份显式指定的文件列表 |
| `createPackageFromStreams(dest, streams)` | 从流描述符打包（`AsarStreamType`） |
| `listPackage(archive, options)` | 列出条目；`{ isPack: true }` 会额外标记每个条目打包/未打包 |
| `statFile(archive, filename, followLinks?)` | 获取单个条目的元信息 |
| `extractFile(archive, filename, followLinks?)` | 把单个条目读成 `Buffer` |
| `extractAll(archive, dest)` | 把全部条目解包到 `dest` |
| `replaceFile(archive, filename, source)` | 用 `source` 文件的内容替换归档内条目 |
| `getRawHeader(archive)` | 读取原始头部 |
| `uncache(archive)` / `uncacheAll()` | 丢弃已缓存的归档状态 |

`createPackage*` 系列是异步的，其余均为同步函数。

### 示例

```javascript
import { createPackage } from 'asarpro';

const src = 'some/path/';
const dest = 'name.asar';

await createPackage(src, dest);
console.log('done.');
```

请注意：目前**不提供**错误处理！

### 替换归档内的文件

```javascript
import { replaceFile } from 'asarpro';

replaceFile('app.asar', 'path/inside/archive.js', 'new-file.js');
```

新内容追加到数据段末尾，条目重新指向它，因此其余所有条目的偏移量都不变
——包括因去重而共享内容的条目。旧字节会残留为空洞，直到用 `createPackage`
重新打包归档。

原本解包到磁盘的条目（unpacked）会直接在 `app.asar.unpacked` 目录下覆盖。

如果 `filename` 不存在、指向目录，或 `source` 无法读取，都会抛出异常。
归档通过临时文件重写后再改名，因此不会留下写了一半的归档。

### 去重（Deduplication）

内容相同的文件只存储一份并共享：第一份写入归档，其余副本的头部条目都指向
同一个 `offset`。对读取方没有任何影响——每个文件仍然有自己的条目、大小、
完整性哈希和执行位——但包含重复内容（打包后的 `node_modules` 很常见）的归档
会更小、打包更快，因为冗余字节永远不会被写入。

未打包文件（`unpack` / `unpackDir`）总是完整写出，因为它们位于归档之外的
磁盘上。

### Transform 转换

可以传入 `transform` 选项，它是一个函数，返回空值或一个 `stream.Transform`。
后者会用于处理将要进入 `.asar` 文件的文件（例如压缩）。

```javascript
import { createPackageWithOptions } from 'asarpro';

const src = 'some/path/';
const dest = 'name.asar';

function transform (filename) {
  return new CustomTransformStream()
}

await createPackageWithOptions(src, dest, { transform: transform });
console.log('done.');
```

## 归档格式（Format）

Asar 使用 [Pickle][pickle] 安全地把二进制值序列化到文件。

Asar 的格式非常扁平：

```markdown
| UInt32: header_size | String: header | Bytes: file1 | ... | Bytes: file42 |
```

`header_size` 和 `header` 用 [Pickle][pickle] 类序列化，其中 `header_size` 的
[Pickle][pickle] 对象占 8 个字节。

`header` 是一个 JSON 字符串，`header_size` 是 `header` 的 `Pickle` 对象大小。

`header` 的结构大致如下：

```json
{
   "files": {
      "tmp": {
         "files": {}
      },
      "usr" : {
         "files": {
           "bin": {
             "files": {
               "ls": {
                 "offset": "0",
                 "size": 100,
                 "executable": true,
                 "integrity": {
                   "algorithm": "SHA256",
                   "hash": "...",
                   "blockSize": 1024,
                   "blocks": ["...", "..."]
                 }
               },
               "cd": {
                 "offset": "100",
                 "size": 100,
                 "executable": true,
                 "integrity": {
                   "algorithm": "SHA256",
                   "hash": "...",
                   "blockSize": 1024,
                   "blocks": ["...", "..."]
                 }
               }
             }
           }
         }
      },
      "etc": {
         "files": {
           "hosts": {
             "offset": "200",
             "size": 32,
             "integrity": {
                "algorithm": "SHA256",
                "hash": "...",
                "blockSize": 1024,
                "blocks": ["...", "..."]
              }
           }
         }
      }
   }
}
```

`offset` 和 `size` 记录从归档中读取文件所需的信息；`offset` 从 0 开始，因此
实际读取时要手动加上 `header_size` 和 `header` 的大小，才能得到文件的真实
偏移量。

内容相同的文件在归档中只共享一份拷贝，所以可能有多个条目指向同一个
`offset`。

`offset` 是用字符串表示的 UINT64 数字，因为 JavaScript `Number` 无法精确表示
UINT64。`size` 是不超过 `Number.MAX_SAFE_INTEGER`（即 `9007199254740991`，
约 8PB）的 JavaScript `Number`。我们没有把 `size` 存成 UINT64，因为 Node.js
中的文件大小用 `Number` 表示，转成 UINT64 不安全。

`integrity` 是一个包含几个键的对象：

* 哈希 `algorithm`，目前只支持 `SHA256`。
* 一个十六进制编码的 `hash` 值，代表整个文件的哈希。
* `blocks`：文件按 `blockSize` 分块后每块的十六进制哈希数组（例如对 4KB 的
  blockSize，如果文件按 4KB 分块成 N 块，该数组就包含 N 个块的哈希）。
* 一个整数值 `blockSize`，表示上面 `blocks` 中每个块的大小（字节）。

[pickle]: https://chromium.googlesource.com/chromium/src/+/main/base/pickle.h