import { createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import https from 'node:https';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';

export const DEFAULT_DOWNLOAD_LIMITS = Object.freeze({
  timeoutMs: 30_000,
  maxBytes: 100 * 1024 * 1024,
  maxRedirects: 5,
});

function parseHttpsUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:') {
    throw new Error(`Download URL must use HTTPS: ${url.href}`);
  }
  return url;
}

function isRedirect(statusCode) {
  return statusCode >= 300 && statusCode < 400;
}

async function removeCreatedDestination(destination) {
  try {
    await unlink(destination);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

export async function downloadToFile({
  url,
  destination,
  signal,
  timeoutMs = DEFAULT_DOWNLOAD_LIMITS.timeoutMs,
  maxBytes = DEFAULT_DOWNLOAD_LIMITS.maxBytes,
  maxRedirects = DEFAULT_DOWNLOAD_LIMITS.maxRedirects,
  ca,
}) {
  const initialUrl = parseHttpsUrl(url);
  let createdDestination = false;

  async function requestUrl(currentUrl, redirectsRemaining) {
    return new Promise((resolve, reject) => {
      const request = https.get(currentUrl, { ca, signal }, (response) => {
        response.setTimeout(timeoutMs, () => {
          response.destroy(new Error(`Download timed out after ${timeoutMs} ms of inactivity.`));
        });
        const statusCode = response.statusCode ?? 0;

        if (isRedirect(statusCode) && response.headers.location) {
          response.resume();
          if (redirectsRemaining === 0) {
            reject(new Error('Download exceeded the HTTPS redirect limit.'));
            return;
          }

          let redirectedUrl;
          try {
            redirectedUrl = parseHttpsUrl(new URL(response.headers.location, currentUrl).href);
          } catch (error) {
            reject(error);
            return;
          }

          requestUrl(redirectedUrl, redirectsRemaining - 1).then(resolve, reject);
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          reject(new Error(`Download failed with HTTP status ${statusCode}.`));
          return;
        }

        let bytes = 0;
        const counter = new Transform({
          transform(chunk, encoding, callback) {
            bytes += chunk.length;
            if (bytes > maxBytes) {
              callback(new Error(`Download exceeded the ${maxBytes}-byte size limit.`));
              return;
            }
            callback(null, chunk);
          },
        });

        void (async () => {
          try {
            const output = createWriteStream(destination, { flags: 'wx' });
            output.once('open', () => {
              createdDestination = true;
            });
            await pipeline(response, counter, output);
            resolve({ bytes, finalUrl: currentUrl.href });
          } catch (error) {
            response.destroy();
            reject(error);
          }
        })();
      });

      request.setTimeout(timeoutMs, () => {
        request.destroy(new Error(`Download timed out after ${timeoutMs} ms of inactivity.`));
      });
      request.once('error', reject);
    });
  }

  try {
    return await requestUrl(initialUrl, maxRedirects);
  } catch (error) {
    if (createdDestination) {
      await removeCreatedDestination(destination);
    }
    throw error;
  }
}
