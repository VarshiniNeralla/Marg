import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

/** Save CSV text as a file: a normal download in the browser, the share sheet in the mobile app. */
export async function downloadCsv(fileName: string, csv: string): Promise<void> {
  const text = '﻿' + csv; // BOM so Excel reads UTF-8 correctly
  if (Capacitor.isNativePlatform()) {
    await Filesystem.writeFile({ path: fileName, data: text, directory: Directory.Cache, encoding: Encoding.UTF8, recursive: true });
    const { uri } = await Filesystem.getUri({ path: fileName, directory: Directory.Cache });
    await Share.share({ title: fileName, url: uri, dialogTitle: 'Share floor table' });
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
