#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把某个目录打成 tar.gz，并显式设置可执行位。

Windows 的 tar.exe 打包后所有文件都是 0644，Linux/macOS 解压出来
runtime/node 和 start.sh 就不可执行了，所以 unix 包改由这个脚本生成。

用法： python pack-tar.py <输出.tar.gz> <要打包的目录>
"""
import os
import sys
import tarfile

EXEC = {"node", "start.sh", "start.command", "start.command"}


def main():
    if len(sys.argv) != 3:
        print("用法: pack-tar.py <out.tar.gz> <dir>")
        return 2
    out, root = sys.argv[1], os.path.abspath(sys.argv[2])
    base = os.path.dirname(root)

    count = 0
    with tarfile.open(out, "w:gz", format=tarfile.PAX_FORMAT) as tf:
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames.sort()
            for name in sorted(filenames):
                full = os.path.join(dirpath, name)
                arc = os.path.relpath(full, base).replace(os.sep, "/")
                info = tf.gettarinfo(full, arc)
                info.mode = 0o755 if name in EXEC else 0o644
                info.uid = info.gid = 0
                info.uname = info.gname = ""
                with open(full, "rb") as f:
                    tf.addfile(info, f)
                count += 1

    print("packed %d files -> %s" % (count, out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
