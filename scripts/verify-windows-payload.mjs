import {createHash} from 'node:crypto';
import {createWriteStream} from 'node:fs';
import {readFile, rename, rm} from 'node:fs/promises';
import {Readable, Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {pathToFileURL} from 'node:url';

const repository = 'aidoo-dental/nhis-checker';
const workflow = '.github/workflows/windows.yml';
const maxBytes = 512 * 1024 * 1024;

export async function verifyPayload(approval, token, output, request = fetch) {
  const {runId, artifactId, commit, digest, version, variant = 'release'} = approval;
  const preview = variant === 'webview2-preview';
  if ((variant !== 'release' && !preview) || !Number.isSafeInteger(runId) || runId <= 0 ||
      !Number.isSafeInteger(artifactId) || artifactId <= 0 ||
      typeof commit !== 'string' || !/^[a-f0-9]{40}$/.test(commit) ||
      typeof digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(digest) ||
      typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version))
    throw new Error('Invalid committed signing approval');

  const branch = preview ? 'prototype/windows-webview2' : 'main';
  const artifactName = preview ? 'NHIS-Checker-Windows-WebView2-signing-payload'
    : 'NHIS-Checker-Windows-signing-payload';
  const github = (path) => request('https://api.github.com/repos/' + repository + path, {
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    redirect: 'manual',
    signal: AbortSignal.timeout(30000)
  });
  const [runResponse, artifactResponse] = await Promise.all([
    github('/actions/runs/' + runId),
    github('/actions/artifacts/' + artifactId)
  ]);
  if (!runResponse.ok || !artifactResponse.ok) throw new Error('Cannot verify GitHub metadata');
  const [run, artifact] = await Promise.all([runResponse.json(), artifactResponse.json()]);
  if (run.id !== runId || run.repository?.full_name !== repository ||
      run.head_repository?.full_name !== repository || run.path !== workflow ||
      run.head_branch !== branch || run.event !== 'push' || run.conclusion !== 'success' ||
      run.head_sha !== commit || artifact.id !== artifactId || artifact.name !== artifactName ||
      artifact.expired !== false || artifact.workflow_run?.id !== runId ||
      artifact.workflow_run?.head_sha !== commit || artifact.digest !== digest ||
      !Number.isSafeInteger(artifact.size_in_bytes) ||
      artifact.size_in_bytes <= 0 || artifact.size_in_bytes > maxBytes)
    throw new Error('GitHub artifact does not match the committed signing approval');

  const redirect = await github('/actions/artifacts/' + artifactId + '/zip');
  if (redirect.status !== 302 || !redirect.headers.get('location'))
    throw new Error('GitHub did not provide an artifact download');
  const download = new URL(redirect.headers.get('location'));
  if (download.protocol !== 'https:' || download.port || download.username || download.password ||
      !/^productionresultssa\d+\.blob\.core\.windows\.net$/.test(download.hostname))
    throw new Error('Unexpected GitHub artifact storage host');
  const archive = await request(download, {
    redirect: 'error', signal: AbortSignal.timeout(180000),
    headers: {'Accept-Encoding': 'identity'}
  });
  if (!archive.ok || !archive.body) throw new Error('Artifact download failed');
  const hash = createHash('sha256');
  let size = 0;
  const checksum = new Transform({
    transform(chunk, encoding, callback) {
      size += chunk.length;
      if (size > artifact.size_in_bytes) return callback(new Error('Unexpected artifact size'));
      hash.update(chunk);
      callback(null, chunk);
    }
  });
  const temporary = output + '.partial';
  try {
    await pipeline(Readable.fromWeb(archive.body), checksum, createWriteStream(temporary, {flags: 'wx'}));
    if (size !== artifact.size_in_bytes || 'sha256:' + hash.digest('hex') !== digest)
      throw new Error('Downloaded artifact does not match the approved digest');
    await rename(temporary, output);
  } catch (error) {
    await rm(temporary, {force: true});
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const token = process.env.NHIS_GITHUB_TOKEN;
    if (!token || token.startsWith('$(')) throw new Error('Missing GitHub Actions read credential');
    const approval = JSON.parse(await readFile('signing-approval.json', 'utf8'));
    await verifyPayload(approval, token, 'artifact.zip');
    console.log('Verified GitHub repository, successful workflow run, commit and archive digest.');
  } catch {
    // Fetch errors may include a temporary storage URL. Keep it out of logs.
    console.error('Could not verify the approved GitHub signing artifact.');
    process.exitCode = 1;
  }
}
