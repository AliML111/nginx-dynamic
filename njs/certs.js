/**
 * NGINX Secure Traffic Serving - JavaScript Module
 *
 * This JavaScript module enables NGINX to securely serve encrypted traffic without server restarts when certificate or key changes occur.
 *
 * Usage:
 * 1. Install and configure NGINX with the NJS module.
 * 2. Include the provided JavaScript module (dynamic.js) in your NGINX configuration.
 * 3. Set up an HTTP endpoint to handle file uploads (e.g., /upload).
 * 4. Clients can use the endpoint to upload certificate and key files using the 'curl' command, like so:
 *    curl http://localhost:8000/upload -F cert=@/path/www.example.com.crt -F key=@/path/www.example.com.key
 *
 * Benefits:
 * - Dynamic SSL certificate and key management without server restarts.
 * - Handle certs/keys file uploads.
 * - Efficient and uninterrupted serving of encrypted traffic using shared_dict to minimize disk IO and cache certs/keys.
 *
 * Note:
 * - Ensure appropriate file permissions for the NGINX server to write uploaded files.
 * - Validate and sanitize uploaded file content to prevent security risks.
 */

import fs from 'fs'

/**
 * Retrieves the cert value
 * @param {NginxHTTPRequest} r - The Nginx HTTP request object.
 * @returns {string, string} - The cert associated with the server name.
 */
function js_cert(r) {
  if (r.variables['cert_name']) {
    return read_cert_or_key(r, "tls_cert", '.cert.pem');
  } else {
    return '';
  }
}

/**
 * Retrieves the key value
 * @param {NginxHTTPRequest} r - The Nginx HTTP request object.
 * @returns {string} - The key associated with the server name.
 */
function js_key(r) {
  if (r.variables['cert_name']) {
    return read_cert_or_key(r, "tls_key", '.key.pem');
  } else {
    return '';
  }
}

/**
 * Join args with a slash remove duplicate slashes
 */
function joinPaths(...args) {
  return args.join('/').replace(/\/+/g, '/');
}

/**
 * Retrieves the key/cert value from file cache or disk
 * @param {NginxHTTPRequest} r - The Nginx HTTP request object.
 * @param {string} fileExtension - The file extension
 * @returns {string} - The key/cert associated with the cert_name.
 */
function read_cert_or_key(r, field, fileExtension) {
  let data = '';
  let path = '';
  const zone = r.variables['shared_dict_zone_name'];
  let certName = r.variables.cert_name;
  let prefix = r.variables['cert_folder'] || '/etc/nginx/certs/';
  path = joinPaths(prefix, certName + fileExtension);
  ngx.log(ngx.ERR, `Resolving ${path}`);
  const key = `${certName}:${field}`;
  const cache = zone && ngx.shared && ngx.shared[zone];

  if (cache) {
    data = cache.get(key) || '';
    if (data) {
      ngx.log(ngx.ERR, `Read ${key} from cache`);
      return data;
    }
  }
  try {
    data = fs.readFileSync(path, 'utf8');
    ngx.log(ngx.ERR, 'Read from fs');
  } catch (e) {
    data = '';
    ngx.log(ngx.ERR,`Error reading from file:', ${path}, . Error=${e}`);
  }
  if (cache && data) {
    try {
      cache.set(key, data);
      ngx.log(ngx.ERR, 'Persisted in cache');
    } catch (e) {
      const errMsg = `Error writing to shared dict zone: ${zone}. Error=${e}`;
      ngx.log(ngx.ERR, errMsg);
    }
  }
  return data
}

/**
 * Clear Cache
 * @param {NginxHTTPRequest} r - The Nginx HTTP request object.
 */
function clear_cache(r) {
  const zone = r.variables['shared_dict_zone_name']
  const cache = zone && ngx.shared && ngx.shared[zone]
  if (cache) {
    cache.clear()
    ngx.log(ngx.ERR, `cleared ${zone}`)
  }
  r.return(200)
}


export default {
  js_cert,
  js_key,
  clear_cache
}
