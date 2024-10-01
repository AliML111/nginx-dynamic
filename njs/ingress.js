// Import required modules
var querystring = require('querystring');
var proxy = ngx.shared.proxy;
var count = ngx.shared.count;

// Function to get the upstream for the request
function getUpstream(req) {
    var ingress_name = req.variables['ingress_service'];

    // Initialize upstreams for this ingress if they haven't been loaded yet
    if (!count.get(ingress_name)) {
        transformUpstreams(req);
    }

    // Get the list of upstreams from the shared dictionary
    var items = proxy.items();
    var numUpstreams = items.length;

    // Return error if no upstreams available
    if (numUpstreams === 0) {
        invalidBackend(req, 503);
        return;
    }

    // Atomic operation to retrieve and increment index and weight in one step
    var indexKey = 'index';
    var weightKey = 'weight';

    var roundRobinIndex = count.incr(indexKey, 1, 0) % numUpstreams;
    var weightCounter = count.incr(weightKey, 1, 0);
    var currentItem = JSON.parse(items[roundRobinIndex][1]);

    var backend = currentItem.endpoint;
    var backendWeight = currentItem.weight;
    count.incr(backend, 1, 0); // Increment request count for the backend
    var reqCounter = count.get(backend);

    // Reset weight counter if it exceeds the backend weight
    if (weightCounter >= backendWeight) {
        count.set(weightKey, 0);
    }

    // ngx.log(ngx.ERR, 'Selected backend: ' + backend + ' at index: ' + roundRobinIndex + ', weight counter: ' + weightCounter + ', backend weight: ' + backendWeight + ', number of reqs: ' + reqCounter);

    // Return the selected backend
    return backend;
}

// Function to handle invalid backend cases
function invalidBackend(req, code) {
    req.return(code, 'Invalid Backend');
    req.finish();
    return '@invalidbackend';
}

// Function to handle request URIs and extract upstream IDs
function handleRequest(req) {
    // Get the complete URI
    var uri = req.uri;
    var upstreamId;

    // Check if the URI ends with a slash
    if (!uri.endsWith('/')) {
        // If it doesn't, add the trailing slash
        uri += '/';
    }

    // Use regex to extract the ID from any URL that ends with /<id>/
    var match = uri.match(/\/(\d+)\/$/);

    // If a match is found, extract the numeric ID
    if (match && match[1]) {
        upstreamId = match[1]; // This will be the numeric ID
        ngx.log(ngx.INFO, 'Extracted Upstream ID: ' + upstreamId);
    }
    return upstreamId;
}

// Function to handle API responses
function responseHandling(req, resCode, resMessage, result, result_info) {
    result = (typeof result !== 'undefined') ? result : null;
    result_info = (typeof result_info !== 'undefined') ? result_info : null;
    let req_id = req.variables.request_id;
    var output = {
        success: resCode >= 200 && resCode < 300,
        errors: resCode >= 400 ? [resMessage] : [],
        request_id: req_id,
        result: result,
        result_info: result_info
    };
    req.headersOut['Content-Type'] = 'application/json';
    req.return(resCode, JSON.stringify(output));
    req.finish();
}

// Function to list upstreams with pagination
function listUpstreams(req) {
    try {
        var upstreamId = handleRequest(req);
        if (upstreamId) {
            if (!proxy.get(upstreamId)) {
                responseHandling(req, 404, 'Upstream not found!');
                return;
            }
            var parsedServer = JSON.parse(proxy.get(upstreamId));
            parsedServer.requests = count.get(parsedServer.endpoint) || 0;

            // Structure the response
            var response = {
                success: true,
                errors: [],
                messages: [],
                result: parsedServer,
                result_info: null // No pagination info for a single item
            };
            req.headersOut['Content-Type'] = 'application/json';
            req.return(200, JSON.stringify(response));
        } else {
            // Collect all upstreams
            var output = [];
            var items = proxy.items();
            for (var i in items) {
                var parsedServer = JSON.parse(items[i][1]);
                parsedServer.requests = count.get(parsedServer.endpoint) || 0;
                output.push(parsedServer);
            }

            // Sort output based on parsedServer.id in ascending order
            output.sort(function(a, b) {
                return a.id - b.id;
            });

            // Use the querystring module to parse query parameters
            var queryString = req.variables.query_string || '';
            var queryParams = querystring.parse(queryString);

            // Pagination parameters with defaults
            var page = parseInt(queryParams.page) || 1;
            page = Math.max(page, 1); // Ensure per_page is at least 1
            var per_page = parseInt(queryParams.per_page) || 10;
            per_page = Math.max(per_page, 1); // Ensure per_page is at least 1

            // Enforce limits to prevent excessive data processing
            var MAX_PER_PAGE = 100;
            var sanitizedPerPage = Math.min(per_page, MAX_PER_PAGE);

            var total_count = output.length;
            var total_pages = Math.ceil(total_count / sanitizedPerPage) || 1;

            // Adjust page number if out of range
            var currentPage = Math.min(Math.max(page, 1), total_pages);

            var start = (currentPage - 1) * sanitizedPerPage;
            var end = start + sanitizedPerPage;

            // Paginate the output
            var paginatedOutput = output.slice(start, end);

            // Structure the response
            var response = {
                success: true,
                errors: [],
                messages: [],
                result: paginatedOutput,
                result_info: {
                    page: currentPage,
                    per_page: sanitizedPerPage,
                    count: paginatedOutput.length,
                    total_count: total_count,
                    total_pages: total_pages
                }
            };
            req.headersOut['Content-Type'] = 'application/json';
            req.return(200, JSON.stringify(response));
        }
    } catch (e) {
        ngx.log(ngx.ERR, 'Failed to list Upstreams: ' + e.message);
        responseHandling(req, 500, 'Failed to list Upstreams');
    }
}

// Function to add new upstreams
function addUpstreams(req) {
    var requestBody = req.requestBuffer;
    if (requestBody) {
        try {
            var payloadData;
            try {
                // Parse the request body as JSON
                payloadData = JSON.parse(requestBody);
            } catch (e) {
                ngx.log(ngx.ERR, 'Invalid JSON: ' + e.message);
                responseHandling(req, 400, 'Invalid JSON');
                return;
            }

            // Get the next unique ID
            var id = getNextUniqueId();

            // Validation
            var validation = validatePayload(payloadData);
            if (!validation.isValid) {
                responseHandling(req, 400, validation.message);
                return;
            }

            // Proceed to save valid data
            payloadData = setDefaults(payloadData);

            payloadData.endpoint = payloadData.scheme + '://' + payloadData.server + ':' + payloadData.port;

            payloadData.id = id;

            proxy.set(id, JSON.stringify(payloadData));

            // Structure the response
            var response = {
                success: true,
                errors: [],
                messages: [],
                result: payloadData,
                result_info: null
            };
            req.headersOut['Content-Type'] = 'application/json';
            req.return(200, JSON.stringify(response));

        } catch (e) {
            ngx.log(ngx.ERR, 'Error processing POST request: ' + e.message);
            responseHandling(req, 500, 'Could not add upstream');
        }
    } else {
        responseHandling(req, 400, 'Data not provided');
        return;
    }
}


// Function to get the next unique ID
function getNextUniqueId() {
    var id;
    while (true) {
        // Increment the 'next_id' counter atomically
        id = count.incr('next_id', 1, 0);
        // Check if the ID already exists
        if (proxy.get(id) === undefined) {
            break; // ID is unique
        }
        // If ID exists, continue to the next one
    }
    return id;
}

// Function to delete upstreams
function deleteUpstreams(req) {
    var upstreamId = handleRequest(req);
    if (upstreamId) {
        try {
            var key = upstreamId;

            if (proxy.get(key) == undefined) {
                responseHandling(req, 404, 'Such an id: ' + key + ' does not exist');
                return;
            }

            proxy.delete(key);
            if (proxy.get(key) == undefined) {
                responseHandling(req, 204, 'Deleted');
            } else {
                ngx.log(ngx.ERR, 'Failed to delete upstream with key: ' + key);
                responseHandling(req, 500, 'Failed to delete upstream');
            }

        } catch (e) {
            ngx.log(ngx.ERR, 'Error processing DELETE request: ' + e.message);
            responseHandling(req, 500, 'Could not delete upstream');
            return;
        }
    } else {
        responseHandling(req, 400, 'Upstream ID not provided');
        return;
    }
}

// Function to purge shared dictionaries
function purgeSharedDict(req) {
    try {
        proxy.clear();
        transformUpstreams(req);
        responseHandling(req, 204, 'Purged');

    } catch (e) {
        ngx.log(ngx.ERR, 'Error processing PURGE request: ' + e.message);
        responseHandling(req, 500, 'There was a problem in purging');
    }
}

// Function to edit upstreams
function editUpstreams(req) {
    var requestBody = req.requestBuffer;
    var upstreamId = handleRequest(req);
    if (requestBody && upstreamId) {
        try {
            var payloadData;
            try {
                // Parse the request body as JSON
                payloadData = JSON.parse(requestBody);
            } catch (e) {
                ngx.log(ngx.ERR, 'Invalid JSON: ' + e.message);
                responseHandling(req, 400, 'Invalid JSON');
                return;
            }

            var key = upstreamId;

            // Validation
            var validation = validatePayload(payloadData);
            if (!validation.isValid) {
                responseHandling(req, 400, validation.message);
                return;
            }

            var existingData = JSON.parse(proxy.get(key));
            // Manually merge existing data with the provided fields using Object.assign
            var updatedData = {};
            for (var prop in existingData) {
                updatedData[prop] = existingData[prop];
            }
            for (var prop in payloadData) {
                updatedData[prop] = payloadData[prop];
            }

            updatedData.endpoint = updatedData.scheme + '://' + updatedData.server + ':' + updatedData.port;

            proxy.set(key, JSON.stringify(updatedData));

            // Structure the response
            var response = {
                success: true,
                errors: [],
                messages: [],
                result: updatedData,
                result_info: null
            };
            req.headersOut['Content-Type'] = 'application/json';
            req.return(200, JSON.stringify(response));

        } catch (e) {
            ngx.log(ngx.ERR, 'Error processing PUT request: ' + e.message);
            responseHandling(req, 500, 'Could not edit upstream');
        }
    } else {
        responseHandling(req, 400, 'Data not provided or Upstream ID missing');
        return;
    }
}

// Main handler for the upstream API
function handleUpstreamAPI(req) {
    var ingress_name = req.variables['ingress_service'];
    var check = count.get(ingress_name);
    if (check == undefined) {
        transformUpstreams(req);
    }
    var upstreamId = handleRequest(req);
    if (req.method === 'GET') {
        listUpstreams(req);
    } else if (req.method === 'POST' && !upstreamId) {
        addUpstreams(req);
    } else if (req.method === 'DELETE' && upstreamId) {
        deleteUpstreams(req);
    } else if (req.method === 'PURGE' && !upstreamId) {
        purgeSharedDict(req);
    } else if ((req.method === 'PUT' || req.method === 'PATCH') && upstreamId) {
        editUpstreams(req);
    } else {
        responseHandling(req, 405, 'Method Not Allowed');
    }
}

// Function to validate payload data
function validatePayload(payloadData) {
    var allowedKeys = ['server', 'down', 'weight', 'scheme', 'port'];
    // Check for any invalid keys in the payload
    var payloadKeys = Object.keys(payloadData);
    for (var i in payloadKeys) {
        if (allowedKeys.indexOf(payloadKeys[i]) === -1) {
            return { isValid: false, message: 'Invalid key provided: ' + payloadKeys[i] };
        }
    }

    // Validate server (string)
    if (payloadData.server && (typeof payloadData.server !== 'string' || !validateServer(payloadData.server))) {
        return { isValid: false, message: 'Invalid server: ' + payloadData.server };
    }

    // Validate port (integer within 1-65535)
    if (payloadData.port && !validatePort(payloadData.port)) {
        return { isValid: false, message: 'Invalid port: ' + payloadData.port };
    }

    // Validate scheme (string)
    if (payloadData.scheme && !validateScheme(payloadData.scheme)) {
        return { isValid: false, message: 'Invalid scheme: ' + payloadData.scheme };
    }

    // Validate down (boolean)
    if (typeof payloadData.down !== 'undefined' && !validateDown(payloadData.down)) {
        return { isValid: false, message: 'Invalid value ' + payloadData.down + ' for "down"' };
    }

    // Validate weight (positive number)
    if (payloadData.weight && !validateWeight(payloadData.weight)) {
        return { isValid: false, message: 'Invalid value ' + payloadData.weight + ' for "weight"' };
    }

    return { isValid: true };
}

// Validation helper functions
function validateDown(down) {
    return typeof down === 'boolean';
}

function validateWeight(weight) {
    return typeof weight === 'number' && (weight % 1 === 0) && weight > 0;
}

function validateServer(server) {
    if (typeof server != 'string') {
        return false; // Ensure the server is a string
    }

    // Regular expressions for domain, IPv4, and IPv6 validation
    var domainPattern = /^(?!:\/\/)([a-zA-Z0-9-_]+\.)+[a-zA-Z]{2,}$/; // Simple domain name validation
    var ipv4Pattern = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/; // IPv4 address validation
    var ipv6Pattern = /^([a-fA-F0-9]{1,4}:){7}[a-fA-F0-9]{1,4}$/; // Simplified IPv6 validation

    // Validate server
    if (!(domainPattern.test(server) || ipv4Pattern.test(server) || ipv6Pattern.test(server)) || server === '') {
        return false;
    }

    return true;
}

function validatePort(port) {
    // Ensure the port is a number and within the valid range (1-65535)
    return typeof port === 'number' && (port % 1 === 0) && port > 0 && port <= 65535;
}

function validateScheme(scheme) {
    return typeof scheme === 'string' && (scheme === 'http' || scheme === 'https');
}

// Function to transform preloaded upstreams into the shared dictionary
function transformUpstreams(req) {
    try {
        for (var key in preloadedUpstreams) {
            var id = parseInt(key, 10); // Convert key to a number
            var upstream = preloadedUpstreams[key];

            // Validation
            var allowedKeys = ['server', 'down', 'weight', 'scheme', 'port'];
            var validation = validatePayload(upstream, allowedKeys);
            if (!validation.isValid) {
                responseHandling(req, 400, validation.message);
                return;
            }

            var server = upstream.server;
            var scheme = upstream.scheme || 'http';
            var port = upstream.port || 80;
            var weight = upstream.weight || 1;
            var down = upstream.down || false;

            proxy.set(id, JSON.stringify({
                'id': id,
                'scheme': scheme,
                'server': server,
                'port': port,
                'down': down,
                'weight': weight,
                'endpoint': scheme + '://' + server + ':' + port
            }));
        }
        var ingress_name = req.variables['ingress_service'];
        count.set(ingress_name, 1);
    } catch (e) {
        ngx.log(ngx.ERR, 'Failed to read Upstreams: ' + e.message);
        responseHandling(req, 500, 'Failed to read Upstreams');
    }
}


function setDefaults(payload){
    if (!payload.scheme){
        payload.scheme = 'http';
    }
    if (!payload.port){
        payload.port = 80;
    } 
    if (!payload.weight){
        payload.weight = 1;
    }
    if (!payload.down){
        payload.down = false;
    } 
    return payload;
}

// Export the module functions
export default {
    getUpstream: getUpstream,
    handleUpstreamAPI: handleUpstreamAPI
};
