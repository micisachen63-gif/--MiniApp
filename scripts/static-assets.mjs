// Cloudflare consumes these as configuration, not downloadable static assets.
// The history patterns mirror worker/public/.assetsignore.
export function isStaticAsset(file){
 return !/(^|\/)(?:\.assetsignore|_headers|_redirects)$|\.bak$|\.backup-[^/]*$|\.before-[^/]*$/.test(file.replaceAll('\\','/'));
}
