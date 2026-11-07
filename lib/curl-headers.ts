// Parsing of "Copy as cURL (bash)" scripts pasted into the API Sync menu.

const normalizeMarkdownUrl = (value: string) => {
  const markdownUrlMatch = value.match(/^\[https?:\/\/[^\]]+\]\((https?:\/\/[^)]+)\)$/i);
  return markdownUrlMatch ? markdownUrlMatch[1].trim() : value;
};

export const extractCurlUrls = (curlCommand: string): string[] => {
  const urls: string[] = [];
  const addUrl = (candidate?: string) => {
    const cleaned = normalizeMarkdownUrl((candidate || '').trim());
    if (!cleaned || cleaned === '--url' || cleaned === 'url' || cleaned.startsWith('-')) return;
    if (!/^https?:\/\//i.test(cleaned)) return;
    if (!urls.includes(cleaned)) urls.push(cleaned);
  };

  const explicitUrlRegex = /--url\s+(?:'([^']+)'|"([^"]+)"|([^\s\\]+))/g;
  let explicitMatch;
  while ((explicitMatch = explicitUrlRegex.exec(curlCommand)) !== null) {
    addUrl(explicitMatch[1] || explicitMatch[2] || explicitMatch[3]);
  }

  const firstArgRegex = /curl\s+(?:'([^']+)'|"([^"]+)"|([^\s\\]+))/g;
  let firstArgMatch;
  while ((firstArgMatch = firstArgRegex.exec(curlCommand)) !== null) {
    addUrl(firstArgMatch[1] || firstArgMatch[2] || firstArgMatch[3]);
  }

  return urls;
};

const findKey = (headers: Record<string, string>, name: string) =>
  Object.keys(headers).find(k => k.toLowerCase() === name.toLowerCase());

// Headers from -H and -b/--cookie. Names are matched case-insensitively, so a
// "-H 'cookie: a'" plus "-b 'b'" ends up as one cookie header, not two keys.
export const parseCurlHeaders = (curlCommand: string): Record<string, string> => {
  const headers: Record<string, string> = {};

  const headerRegex = /-H\s+['"]([^'"]+)['"]/g;
  let match;
  while ((match = headerRegex.exec(curlCommand)) !== null) {
    const headerStr = match[1];
    const splitIndex = headerStr.indexOf(':');
    if (splitIndex > -1) {
      const key = headerStr.slice(0, splitIndex).trim();
      const value = normalizeMarkdownUrl(headerStr.slice(splitIndex + 1).trim());
      const existing = findKey(headers, key);
      if (existing) delete headers[existing];
      headers[key] = value;
    }
  }

  const cookieRegex = /(?:-b|--cookie)\s+['"]([^'"]+)['"]/g;
  let cookieMatch;
  while ((cookieMatch = cookieRegex.exec(curlCommand)) !== null) {
    const existing = findKey(headers, 'cookie');
    if (existing) {
      headers[existing] = headers[existing] + '; ' + cookieMatch[1];
    } else {
      headers['Cookie'] = cookieMatch[1];
    }
  }

  return headers;
};

// Hosts of a stored config URL. Several URLs are stored one per line; URL
// templates such as {{id}} still parse.
export const configHosts = (url: string | null | undefined): string[] =>
  (url || '')
    .split('\n')
    .map(u => {
      try {
        return new URL(u.trim()).host.toLowerCase();
      } catch {
        return '';
      }
    })
    .filter(Boolean);

// Overwrite stored headers with fresh ones. Headers only in `stored` are kept;
// a fresh header replaces a stored one whatever the letter case.
export const mergeHeaders = (stored: string | null | undefined, fresh: Record<string, string>): Record<string, string> => {
  let merged: Record<string, string> = {};
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) merged = { ...parsed };
    } catch {
      // unreadable headers are replaced by the fresh set
    }
  }
  for (const [key, value] of Object.entries(fresh)) {
    const existing = findKey(merged, key);
    if (existing) delete merged[existing];
    merged[key] = value;
  }
  return merged;
};
