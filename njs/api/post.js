import fs from 'fs'
var count = ngx.shared.count; // Shared dictionary for counting requests and other counters

/**
 * Join args with a slash remove duplicate slashes
 */
function joinPaths(...args) {
    return args.join('/').replace(/\/+/g, '/');
}

function addCertificates(req, domainName){
    try {
        const prefix = req.variables['cert_folder'] || '/etc/nginx/certs/';
        let certName = domainName;
        let payloadData = validate.validateInput(req);
        let kv = ngx.shared.kv;
        let fields = [["tls_key", ".key.pem"], ["tls_cert", ".cert.pem"]];
        for (let i in fields) {
            let object = fields[i][0];
            let value = payloadData[object];
            if (!isBase64(value)){

                ingress.responseHandling(req, 400, `${object} is not in base64 format`);
            }
            value = decodeBase64(value);
            

            try {
                let path = joinPaths(prefix, certName + fields[i][1]);
                fs.writeFileSync(path, value);
                ngx.log(ngx.ERR, `Wrote to file. Path: ${path}`);
                // if (cache) {
                    let key = certName + ":" + object;
                    kv.set(key, value);
                    // kv.set(key + ':base64', payloadData[object]);
                    ngx.log(ngx.ERR, `Wrote to cache. Key: ${key}`);
                // }
              } catch (err) {
                ngx.log(ngx.ERR, `Error saving ${err}`);
                ingress.responseHandling(req, 500, `Error saving ${err}`);
              }
        }
    
        // Set the Content-Type header and send the response
        req.headersOut['Content-Type'] = 'application/json';
        req.return(201, JSON.stringify(payloadData));
    } catch (e) {
        ngx.log(ngx.ERR, 'Failed to add certificate: ' + e.message);
        ingress.responseHandling(req, 500, 'Failed to add certificate');
    } 
}

function decodeBase64(encodedString) {
    var buffer = Buffer.from(encodedString, 'base64');
    var decodedString = buffer.toString();
    return decodedString;
}

function isBase64(str) {
    // Check if the string is empty or not a string
    if (!str || typeof str !== 'string') {
        return false;
    }

    // Remove any whitespace or line breaks
    str = str.trim();

    // Base64 strings should have a length that's a multiple of 4
    if (str.length % 4 !== 0) {
        return false;
    }

    // Regular expression to check for valid Base64 characters
    var base64Regex = /^[A-Za-z0-9+/]+={0,2}$/;

    // Test the string against the regex
    if (!base64Regex.test(str)) {
        return false;
    }

    return true;
}

// Function to add new upstreams
function addUpstreams(req, upstreamName) {
    var payloadData = validate.validateInput(req);
        try {

            if (!payloadData.server) {
                ngx.log(ngx.ERR, 'Server field is empty');
                ingress.responseHandling(req, 400, 'Server field is empty');
                return;
            }

            // Get the next unique ID for the upstream
            var id = getNextUniqueId(upstreamName);

            // Validate the payload data
            var validation = validate.validatePayload(payloadData);
            if (!validation.isValid) {
                ingress.responseHandling(req, 400, validation.message);
                return;
            }

            // Set default values for missing fields
            payloadData = setDefaults(payloadData);

            // Construct the upstream data object
            payloadData = {
                'id': id,
                'scheme': payloadData.scheme,
                'server': payloadData.server,
                'port': payloadData.port,
                'route': payloadData.route,
                'down': payloadData.down,
                'weight': payloadData.weight,
                'endpoint': payloadData.scheme + '://' + payloadData.server + ':' + payloadData.port + payloadData.route
            };

            // Store the new upstream in the shared dictionary
            upstreamName.set(id, JSON.stringify(payloadData));

            // Construct the response object
            var response = {
                success: true,
                errors: [],
                messages: [],
                result: payloadData,
                result_info: null
            };

            // Set the Content-Type header and send the response
            req.headersOut['Content-Type'] = 'application/json';
            req.return(200, JSON.stringify(response));

        } catch (e) {
            ngx.log(ngx.ERR, 'Error processing POST request: ' + e.message);
            ingress.responseHandling(req, 500, 'Could not add upstream');
        }
}

// Function to get the next unique ID
function getNextUniqueId(upstreamName) {
    var id;
    while (true) {
        // Increment the 'next_id' counter atomically
        id = count.incr('next_id', 1, 0);
        // Check if the ID already exists; if not, break the loop
        if (upstreamName.get(id) === undefined) {
            break; // ID is unique
        }
        // If ID exists, continue to the next one
    }
    return id;
}

// Function to set default values for missing payload fields
function setDefaults(payload) {
    if (!payload.scheme) {
        payload.scheme = 'http';
    }
    if (!payload.port) {
        payload.port = 80;
    }
    if (!payload.weight) {
        payload.weight = 1;
    }
    if (!payload.down) {
        payload.down = false;
    }
    if (!payload.route) {
        payload.route = '';
    }
    return payload;
}

export default {
    addUpstreams,
    addCertificates
}