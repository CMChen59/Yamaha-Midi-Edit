import { BinaryWriter } from './binary-writer';
import type { YamahaFileParsed } from '../models/types';

export class YamahaWriter {
  /**
   * 將解析後的結構無損重構為二進位 Buffer
   */
  public static write(parsed: YamahaFileParsed): Uint8Array {
    const writer = new BinaryWriter();

    // 1. 寫入 MThd 標頭
    writer.writeString('MThd');
    writer.writeUint32BE(6); // MThd 標準長度固定為 6 bytes
    writer.writeUint16BE(parsed.midiFormat);
    writer.writeUint16BE(parsed.tracks.length);
    writer.writeUint16BE(parsed.division);

    // 2. 寫入各軌 MTrk (使用無損保留的 rawChunk)
    for (const track of parsed.tracks) {
      if (track.rawChunk && track.rawChunk.length > 0) {
        writer.writeBytes(track.rawChunk);
      } else {
        throw new Error(`Track ${track.trackIndex} 缺少 rawChunk，無法進行無損重構`);
      }
    }

    // 3. 寫入 Yamaha 專屬自訂區塊 (CASM, OTS, etc.)
    for (const chunk of parsed.customChunks) {
      writer.writeString(chunk.id.padEnd(4, ' '));
      writer.writeUint32BE(chunk.data.length);
      writer.writeBytes(chunk.data);
    }

    return writer.toUint8Array();
  }
}
