import { describe, it, beforeEach, expect } from 'vitest';
import path from 'node:path';
import { wrappedFs as fs } from '../src/wrapped-fs.js';
import {
  createPackage,
  createPackageWithOptions,
  extractFile,
  listPackage,
  replaceFile,
  statFile,
  uncache,
} from '../src/asar.js';
import { TEST_APPS_DIR } from './util/constants.js';

const ARCHIVE = path.join(TEST_APPS_DIR, 'replace.asar');
const SOURCE_DIR = path.join(TEST_APPS_DIR, 'replace-src');

function writeSource(name: string, content: string | Buffer): string {
  const file = path.join(SOURCE_DIR, name);
  fs.mkdirpSync(path.dirname(file));
  fs.writeFileSync(file, content);
  return file;
}

describe('replaceFile', () => {
  beforeEach(() => {
    fs.rmSync(TEST_APPS_DIR, { recursive: true, force: true });
    fs.mkdirpSync(SOURCE_DIR);
    uncache(ARCHIVE);
  });

  it('replaces a packed file with different-sized content', async () => {
    await createPackage('test/input/packthis/', ARCHIVE);
    const before = listPackage(ARCHIVE, { isPack: false });
    const source = writeSource('file0.txt', 'totally new content\n');

    replaceFile(ARCHIVE, 'file0.txt', source);

    expect(extractFile(ARCHIVE, 'file0.txt').toString()).toBe('totally new content\n');
    expect(listPackage(ARCHIVE, { isPack: false })).toEqual(before);
    const entry = statFile(ARCHIVE, 'file0.txt');
    if (!('size' in entry)) {
      throw new Error('expected a file entry');
    }
    expect(entry.size).toBe('totally new content\n'.length);
    expect(extractFile(ARCHIVE, 'dir1/file1.txt').toString()).toBe(
      fs.readFileSync('test/input/packthis/dir1/file1.txt', 'utf8'),
    );
  });

  it('replaces content of identical size', async () => {
    await createPackage('test/input/packthis/', ARCHIVE);
    const original = fs.readFileSync('test/input/packthis/file0.txt');
    const source = writeSource('same-size.bin', Buffer.alloc(original.length, 0x61));

    replaceFile(ARCHIVE, 'file0.txt', source);

    expect(extractFile(ARCHIVE, 'file0.txt').toString()).toBe('a'.repeat(original.length));
    expect(original.length).toBeGreaterThan(0);
  });

  it('fills an empty file and empties a non-empty file', async () => {
    await createPackage('test/input/packthis/', ARCHIVE);

    const withBytes = writeSource('full.txt', 'now emptyfile has bytes');
    replaceFile(ARCHIVE, 'emptyfile.txt', withBytes);
    expect(extractFile(ARCHIVE, 'emptyfile.txt').toString()).toBe('now emptyfile has bytes');

    const empty = writeSource('zero.txt', '');
    replaceFile(ARCHIVE, 'file0.txt', empty);
    expect(extractFile(ARCHIVE, 'file0.txt').length).toBe(0);
  });

  it('replaces an unpacked file', async () => {
    await createPackageWithOptions('test/input/packthis/', ARCHIVE, { unpack: '*.png' });
    const unpackedPath = path.join(`${ARCHIVE}.unpacked`, 'dir2', 'file2.png');
    expect(fs.existsSync(unpackedPath)).toBe(true);
    const source = writeSource('file2.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));

    replaceFile(ARCHIVE, 'dir2/file2.png', source);

    const expected = fs.readFileSync(source);
    expect(fs.readFileSync(unpackedPath).equals(expected)).toBe(true);
    expect(extractFile(ARCHIVE, 'dir2/file2.png').equals(expected)).toBe(true);
    const entry = statFile(ARCHIVE, 'dir2/file2.png');
    if (!('size' in entry)) {
      throw new Error('expected a file entry');
    }
    expect(entry.size).toBe(expected.length);
  });

  it('keeps shared contents intact when replacing one of the duplicates', async () => {
    const srcDir = path.join(SOURCE_DIR, 'dedup');
    fs.mkdirpSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'a.txt'), 'duplicate content\n');
    fs.writeFileSync(path.join(srcDir, 'b.txt'), 'duplicate content\n');
    await createPackage(srcDir, ARCHIVE);

    const aBefore = statFile(ARCHIVE, 'a.txt');
    const bBefore = statFile(ARCHIVE, 'b.txt');
    if (!('offset' in aBefore) || !('offset' in bBefore)) {
      throw new Error('expected file entries');
    }
    expect(aBefore.offset).toBe(bBefore.offset);

    const source = writeSource('a-new.txt', 'unique new content\n');
    replaceFile(ARCHIVE, 'a.txt', source);

    expect(extractFile(ARCHIVE, 'a.txt').toString()).toBe('unique new content\n');
    expect(extractFile(ARCHIVE, 'b.txt').toString()).toBe('duplicate content\n');
    const bAfter = statFile(ARCHIVE, 'b.txt');
    if (!('offset' in bAfter)) {
      throw new Error('expected a file entry');
    }
    expect(bAfter.offset).toBe(bBefore.offset);
  });

  it('accepts a leading slash in the archive path', async () => {
    await createPackage('test/input/packthis/', ARCHIVE);
    const source = writeSource('file0.txt', 'leading slash\n');

    replaceFile(ARCHIVE, '/file0.txt', source);

    expect(extractFile(ARCHIVE, 'file0.txt').toString()).toBe('leading slash\n');
  });

  it('throws for a file that is not in the archive', async () => {
    await createPackage('test/input/packthis/', ARCHIVE);
    const source = writeSource('x.txt', 'x');
    expect(() => replaceFile(ARCHIVE, 'does-not-exist.txt', source)).toThrow(
      '"does-not-exist.txt" was not found in this archive',
    );
  });

  it('throws when the target is a directory', async () => {
    await createPackage('test/input/packthis/', ARCHIVE);
    const source = writeSource('x.txt', 'x');
    expect(() => replaceFile(ARCHIVE, 'dir1', source)).toThrow('but found a directory');
  });

  it('throws when the source does not exist', async () => {
    await createPackage('test/input/packthis/', ARCHIVE);
    expect(() => replaceFile(ARCHIVE, 'file0.txt', path.join(SOURCE_DIR, 'missing.txt'))).toThrow();
  });
});
