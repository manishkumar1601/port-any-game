# Third-party rule data

The rule files in this folder (`engines.json`, `protection.json`, `apis.json`) are hand-curated. Many file names, section names, magic values and import names were derived from the detection rules of the three MIT-licensed projects below. No code or data files from these projects are vendored; each rule records its origin in its `source` field (`steamdb`, `die`, `bos`, or `local` for rules written for this project).

| Project | Repository | Pinned commit | Rule `source` |
|---|---|---|---|
| SteamDB FileDetectionRuleSets | https://github.com/SteamDatabase/FileDetectionRuleSets | 243cf741921d2c8fd6b844f83831edf4692cf788 | `steamdb` |
| Detect It Easy (signature database, `db/`) | https://github.com/horsicq/Detect-It-Easy | 25c71e68c8ec4d7b941aa6c3b5cb2167713835f1 | `die` |
| SabreTools BinaryObjectScanner | https://github.com/SabreTools/BinaryObjectScanner | 385a5dff25326d14a7d40ac8861b1d0dd818b752 | `bos` |

Each project is distributed under the MIT License:

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Copyright remains with the respective authors of each project (see the licence file at the pinned commit of each repository).
