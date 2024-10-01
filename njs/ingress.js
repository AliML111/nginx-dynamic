// Import required modules
var querystring = require('querystring');
var proxy = ngx.shared.proxy; // Shared dictionary for proxy information
var count = ngx.shared.count; // Shared dictionary for counting requests and other counters

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

    // Return error if no upstreams are available
    if (numUpstreams === 0) {
        invalidBackend(req, 503);
        return;
    }

    // Atomic operation to retrieve and increment index and weight in one step
    var indexKey = 'index';
    var weightKey = 'weight';

    // Calculate the round-robin index and increment the counters
    var roundRobinIndex = count.incr(indexKey, 1, 0) % numUpstreams;
    var weightCounter = count.incr(weightKey, 1, 0);

    // Get the current upstream item based on the round-robin index
    var currentItem = JSON.parse(items[roundRobinIndex][1]);

    var backend = currentItem.endpoint;
    var backendWeight = currentItem.weight;

    // Increment request count for the backend
    count.incr(backend, 1, 0);
    var reqCounter = count.get(backend);

    // Reset weight counter if it exceeds the backend weight
    if (weightCounter >= backendWeight) {
        count.set(weightKey, 0);
    }

    // Optionally log the selected backend (commented out)
    // ngx.log(ngx.ERR, 'Selected backend: ' + backend + ' at index: ' + roundRobinIndex +
    //     ', weight counter: ' + weightCounter + ', backend weight: ' + backendWeight +
    //     ', number of reqs: ' + reqCounter);

    // Return the selected backend endpoint
    return backend;
}

// Function to handle invalid backend cases
function invalidBackend(req, code) {
    req.return(code, 'Invalid Backend');
    req.finish();
    return '@invalidbackend';
}

// Function to handle request URIs and extract upstream IDs for a RESTful API
function handleRequest(req) {
    try {
        // Get the complete URI
        var uri = req.uri;
        var upstreamId = null;

        // Check if the URI ends with a slash; if not, add one
        if (!uri.endsWith('/')) {
            uri += '/';
            // Optionally log the updated URI (commented out)
            // ngx.log(ngx.ERR, 'Added trailing slash: ' + uri);
        }

        // Define the expected route pattern for upstreams with an ID
        var upstreamsPattern = /^\/api\/v1\/upstreams\/(\d+)\/$/;

        // Check if the URI matches the pattern /api/v1/upstreams/<id>/
        var match = uri.match(upstreamsPattern);

        // If a match is found, extract the numeric ID
        if (match && match[1]) {
            upstreamId = match[1]; // This will be the numeric ID
            ngx.log(ngx.INFO, 'Extracted Upstream ID: ' + upstreamId);
        } else {
            // If the URI doesn't match, it's possibly a request for all upstreams
            // upstreamId remains null
        }

        return upstreamId;
    } catch (e) {
        ngx.log(ngx.ERR, 'Failed to handle URI: ' + e.message);
        responseHandling(req, 500, 'Failed to handle URI');
    }
}

// Function to handle API responses
function responseHandling(req, resCode, resMessage, result, result_info) {
    // Set default values if parameters are not provided
    result = (typeof result !== 'undefined') ? result : null;
    result_info = (typeof result_info !== 'undefined') ? result_info : null;
    let req_id = req.variables.request_id;

    // Construct the response object
    var output = {
        success: resCode >= 200 && resCode < 300,
        errors: resCode >= 400 ? resMessage : "",
        message: result,
        request_id: req_id,
        result: result,
        result_info: result_info
    };

    // Set the Content-Type header and send the response
    req.headersOut['Content-Type'] = 'application/json';
    req.return(resCode, JSON.stringify(output));
    req.finish();
}

// Function to parse and validate query parameters with manual defaults
function parseQueryParams(req, defaults) {
    // Provide default values if not supplied
    defaults = defaults || { page: 1, per_page: 10, max_per_page: 100 };

    // Get the query string from the request
    var queryString = req.variables.query_string || '';
    var queryParams = querystring.parse(queryString);

    // Parse 'page' and ensure it's a valid number; default to 1
    var page = parseInt(queryParams.page);
    if (isNaN(page) || page < 1) {
        page = defaults.page;
    }

    // Parse 'per_page' and ensure it's within valid limits
    var per_page = parseInt(queryParams.per_page);
    if (isNaN(per_page) || per_page < 1) {
        per_page = defaults.per_page;
    } else if (per_page > defaults.max_per_page) {
        per_page = defaults.max_per_page;
    }

    return { page: page, per_page: per_page };
}

// Function to handle request and response for multiple upstreams
function handleMultipleUpstreams(req) {
    var output = [];
    var items = proxy.items();

    // Collect all upstreams and their request counts
    for (var i in items) {
        var parsedServer = JSON.parse(items[i][1]);
        parsedServer.requests = count.get(parsedServer.endpoint) || 0;
        output.push(parsedServer);
    }

    // Sort the upstreams by ID in ascending order
    output.sort(function (a, b) {
        return a.id - b.id;
    });

    // Parse query parameters for pagination
    var queryParams = parseQueryParams(req);

    var total_count = output.length; // Total number of upstreams
    var total_pages = Math.ceil(total_count / queryParams.per_page) || 1;
    var currentPage = Math.min(queryParams.page, total_pages);

    var start = (currentPage - 1) * queryParams.per_page;
    var end = start + queryParams.per_page;

    // Paginate the output based on the query parameters
    var paginatedOutput = output.slice(start, end);

    // Construct the response object
    var response = {
        success: true,
        errors: [],
        messages: [],
        result: paginatedOutput,
        result_info: {
            page: currentPage,
            per_page: queryParams.per_page,
            count: paginatedOutput.length,
            total_count: total_count,
            total_pages: total_pages
        }
    };

    // Set the Content-Type header and send the response
    req.headersOut['Content-Type'] = 'application/json';
    req.return(200, JSON.stringify(response));
}

// Function to handle request and response for a single upstream
function handleSingleUpstream(req, upstreamId) {
    // Check if the upstream exists
    if (!proxy.get(upstreamId)) {
        responseHandling(req, 404, 'Upstream not found!');
        return;
    }

    // Retrieve and parse the upstream data
    var parsedServer = JSON.parse(proxy.get(upstreamId));
    parsedServer.requests = count.get(parsedServer.endpoint) || 0;

    // Construct the response object
    var response = {
        success: true,
        errors: [],
        messages: [],
        result: parsedServer,
        result_info: null // No pagination info for a single item
    };

    // Set the Content-Type header and send the response
    req.headersOut['Content-Type'] = 'application/json';
    req.return(200, JSON.stringify(response));
}

// Main function to list upstreams with pagination
function listUpstreams(req) {
    try {
        var upstreamId = handleRequest(req);

        if (upstreamId) {
            // Handle request for a single upstream
            handleSingleUpstream(req, upstreamId);
        } else {
            // Handle request for all upstreams
            handleMultipleUpstreams(req);
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

            if (!payloadData.server) {
                ngx.log(ngx.ERR, 'Server field is empty');
                responseHandling(req, 400, 'Server field is empty');
                return;
            }

            // Get the next unique ID for the upstream
            var id = getNextUniqueId();

            // Validate the payload data
            var validation = validatePayload(payloadData);
            if (!validation.isValid) {
                responseHandling(req, 400, validation.message);
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
                'down': payloadData.down,
                'weight': payloadData.weight,
                'endpoint': payloadData.scheme + '://' + payloadData.server + ':' + payloadData.port
            };

            // Store the new upstream in the shared dictionary
            proxy.set(id, JSON.stringify(payloadData));

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
        // Check if the ID already exists; if not, break the loop
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
                responseHandling(req, 404, 'Upstream ID ' + key + ' does not exist');
                return;
            }

            // Delete the upstream from the shared dictionary
            proxy.delete(key);

            if (proxy.get(key) == undefined) {
                responseHandling(req, 204, 'Deleted');
            } else {
                ngx.log(ngx.ERR, 'Failed to delete upstream with ID: ' + key);
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
        // Clear the shared dictionaries and reinitialize upstreams
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

            // Check if id exists
            if(!proxy.get(key)){
                responseHandling(req, 400, `entered id: ${key} does not exits`);
                return;
            }

            // Validate the payload data
            var validation = validatePayload(payloadData);
            if (!validation.isValid) {
                responseHandling(req, 404, validation.message);
                return;
            }

            // Retrieve existing upstream data
            var existingData = JSON.parse(proxy.get(key));

            // Merge existing data with the provided fields
            var updatedData = {};
            for (var prop in existingData) {
                updatedData[prop] = existingData[prop];
            }
            for (var prop in payloadData) {
                updatedData[prop] = payloadData[prop];
            }

            // Update the endpoint based on new data
            updatedData.endpoint = updatedData.scheme + '://' + updatedData.server + ':' + updatedData.port;

            // Save the updated upstream data
            proxy.set(key, JSON.stringify(updatedData));

            // Construct the response object
            var response = {
                success: true,
                errors: [],
                messages: [],
                result: updatedData,
                result_info: null
            };

            // Set the Content-Type header and send the response
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

    // Initialize upstreams if they haven't been loaded yet
    if (check == undefined) {
        transformUpstreams(req);
    }

    // Determine if an upstream ID is present in the request
    var upstreamId = handleRequest(req);

    // Handle the request based on HTTP method and presence of upstream ID
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

    // Validate 'server' field (should be a valid server address)
    if (payloadData.server && (typeof payloadData.server !== 'string' || !validateServer(payloadData.server))) {
        return { isValid: false, message: 'Invalid server: ' + payloadData.server };
    }

    // Validate 'port' field (should be an integer between 1 and 65535)
    if (payloadData.port && !validatePort(payloadData.port)) {
        return { isValid: false, message: 'Invalid port: ' + payloadData.port };
    }

    // Validate 'scheme' field (should be 'http' or 'https')
    if (payloadData.scheme && !validateScheme(payloadData.scheme)) {
        return { isValid: false, message: 'Invalid scheme: ' + payloadData.scheme };
    }

    // Validate 'down' field (should be a boolean)
    if (typeof payloadData.down !== 'undefined' && !validateDown(payloadData.down)) {
        return { isValid: false, message: 'Invalid value ' + payloadData.down + ' for "down"' };
    }

    // Validate 'weight' field (should be a positive integer)
    if (payloadData.weight && !validateWeight(payloadData.weight)) {
        return { isValid: false, message: 'Invalid value ' + payloadData.weight + ' for "weight"' };
    }

    return { isValid: true };
}

// Validation helper functions

// Validate the 'down' field (boolean)
function validateDown(down) {
    return typeof down === 'boolean';
}

// Validate the 'weight' field (positive integer)
function validateWeight(weight) {
    return typeof weight === 'number' && (weight % 1 === 0) && weight > 0;
}

// Validate the 'server' field (valid domain or IP address)
function validateServer(server) {
    if (typeof server != 'string') {
        return false; // Ensure the server is a string
    }

    // Regular expressions for domain, IPv4, and IPv6 validation
    var domainPattern = /^(?!:\/\/)([a-zA-Z0-9-_]+\.)+[a-zA-Z]{2,}$/; // Simple domain name validation
    var ipv4Pattern = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/; // IPv4 address validation
    var ipv6Pattern = /^([a-fA-F0-9]{1,4}:){7}[a-fA-F0-9]{1,4}$/; // Simplified IPv6 validation

    // Validate server against the patterns
    if (!(domainPattern.test(server) || ipv4Pattern.test(server) || ipv6Pattern.test(server)) || server === '') {
        return false;
    }

    return true;
}

// Validate the 'port' field (integer between 1 and 65535)
function validatePort(port) {
    return typeof port === 'number' && (port % 1 === 0) && port > 0 && port <= 65535;
}

// Validate the 'scheme' field ('http' or 'https')
function validateScheme(scheme) {
    return typeof scheme === 'string' && (scheme === 'http' || scheme === 'https');
}

// Function to transform preloaded upstreams into the shared dictionary
function transformUpstreams(req) {
    try {
        for (var key in preloadedUpstreams) {
            var id = parseInt(key, 10); // Convert key to a number
            var upstream = preloadedUpstreams[key];

            // Validation of the upstream data
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

            // Store the upstream in the shared dictionary
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

        // Mark the ingress as initialized
        var ingress_name = req.variables['ingress_service'];
        count.set(ingress_name, 1);
    } catch (e) {
        ngx.log(ngx.ERR, 'Failed to read Upstreams: ' + e.message);
        responseHandling(req, 500, 'Failed to read Upstreams');
    }
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
    return payload;
}

// Export the module functions
export default {
    getUpstream: getUpstream,
    handleUpstreamAPI: handleUpstreamAPI
};
