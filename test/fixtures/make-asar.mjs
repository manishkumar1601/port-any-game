// Minimal asar writer for tests (reused by the web-extract tests).
// Layout verified against @electron/asar 4.3.2 (lib/disk.js createFilesystemWriteStream, lib/pickle.js):
//   [0..3]  UInt32LE 4 (size pickle payload)   [4..7] UInt32LE headerSize = length of header pickle
//   header pickle: [0..3] payload size, [4..7] JSON byte length, JSON bytes padded to 4
//   (so the JSON length sits at file offset 12 and the JSON at 16); file data starts at 8 + headerSize.
// Each file node is {size, offset} with offset as a decimal string relative to the data start.
export function makeAsar(files) {
  const root = { files: {} };
  const chunks = [];
  let offset = 0;
  for (const [p, content] of Object.entries(files)) {
    const data = Buffer.from(content);
    const parts = p.split('/');
    let dir = root;
    for (const part of parts.slice(0, -1)) dir = dir.files[part] ??= { files: {} };
    dir.files[parts.at(-1)] = { size: data.length, offset: String(offset) };
    chunks.push(data);
    offset += data.length;
  }
  const json = Buffer.from(JSON.stringify(root));
  const padded = Math.ceil(json.length / 4) * 4;
  const pickle = Buffer.alloc(8 + padded);
  pickle.writeUInt32LE(4 + padded, 0);
  pickle.writeUInt32LE(json.length, 4);
  json.copy(pickle, 8);
  const prefix = Buffer.alloc(8);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(pickle.length, 4);
  return Buffer.concat([prefix, pickle, ...chunks]);
}
