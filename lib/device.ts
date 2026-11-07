// Short device description from a user agent, e.g. "HP · Chrome · Android".

export const describeDevice = (ua: string): string => {
  const s = ua || '';
  const kind = /iPad|Tablet|PlayBook|Silk/i.test(s) || (/Android/i.test(s) && !/Mobile/i.test(s))
    ? 'Tablet'
    : /Mobi|iPhone|iPod|Android/i.test(s) ? 'HP' : 'Desktop';
  const browser = /Edg\//.test(s) ? 'Edge'
    : /OPR\/|Opera/.test(s) ? 'Opera'
    : /SamsungBrowser/.test(s) ? 'Samsung Internet'
    : /Firefox\/|FxiOS/.test(s) ? 'Firefox'
    : /Chrome\/|CriOS/.test(s) ? 'Chrome'
    : /Safari\//.test(s) ? 'Safari'
    : 'Browser lain';
  const os = /Windows/.test(s) ? 'Windows'
    : /iPhone|iPad|iPod/.test(s) ? 'iOS'
    : /Mac OS X|Macintosh/.test(s) ? 'macOS'
    : /Android/.test(s) ? 'Android'
    : /CrOS/.test(s) ? 'ChromeOS'
    : /Linux/.test(s) ? 'Linux'
    : 'OS lain';
  return `${kind} · ${browser} · ${os}`;
};
