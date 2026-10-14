export async function zipFiles(files: string[], outZip: string): Promise<string> {
  const { default: AdmZip } = await import("adm-zip");
  const zip = new AdmZip();
  for (const file of files) {
    zip.addLocalFile(file);
  }
  await zip.writeZipPromise(outZip, { overwrite: true });
  return outZip;
}

export async function zipBuffers(
  files: { name: string; buffer: Buffer }[],
  outZip: string,
): Promise<string> {
  const { default: AdmZip } = await import("adm-zip");
  const zip = new AdmZip();
  for (const file of files) {
    zip.addFile(file.name, file.buffer);
  }
  await zip.writeZipPromise(outZip, { overwrite: true });
  return outZip;
}
