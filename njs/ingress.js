// Import required modules
var count = ngx.shared.count; // Shared dictionary for counting requests and other counters


function handleRequest(req) {
    try {
        // Get the complete URI and normalize it
        let uri = req.uri.trim();

        // Remove trailing slash for consistent processing
        if (uri.endsWith('/')) {
            uri = uri.slice(0, -1);
        }

        // Define the expected route pattern
        // Matches:
        // - /api/v1/{protocol}/upstreams/{upstreamName}(/id)
        // - /api/v1/{protocol}/certs/{domainName}
        const pattern = /^\/api\/v1\/(http|stream)\/(upstreams|certs)\/([^\/]+)(?:\/(\d+))?$/;

        // Match the URI against the pattern
        const match = uri.match(pattern);

        if (match) {
            const protocol = match[1];         // 'http' or 'stream'
            const resourceType = match[2];     // 'upstreams' or 'certs'
            const resourceName = match[3];     // 'proxy' or 'example.com'
            const resourceId = match[4] || null; // '1' or null

            // Log the extracted components for debugging
            ngx.log(ngx.ERR, `Protocol: ${protocol}, Resource Type: ${resourceType}, Resource Name: ${resourceName}, Resource ID: ${resourceId}`);

            return {
                protocol: protocol,
                resourceType: resourceType,
                resourceName: resourceName,
                resourceId: resourceId
            };
            
        } else {
            // URI doesn't match expected patterns
            ngx.log(ngx.ERR, `Invalid URI format: ${uri}`);
            return;
        }
    } catch (e) {
        // Log the error and respond with an internal server error
        ngx.log(ngx.ERR, `Error in handleRequest: ${e.message}`);
        responseHandling(req, 500, 'Internal Server Error');
        return;
    }
}


// Function to handle API responses
function responseHandling(req, resCode, resMessage, result, result_info) {
    // Set default values if parameters are not provided
    result = (typeof result !== 'undefined') ? result : null;
    result_info = (typeof result_info !== 'undefined') ? result_info : null;
    let req_id = req.variables.request_id;

    // Construct the response object
    let output = {
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

// Function to purge shared dictionaries
// function purgeSharedDict(req) {
//     try {
//         // Clear the shared dictionaries and reinitialize upstreams
//         upstreamName.clear();
//         transformUpstreams(req);
//         responseHandling(req, 204, 'Purged');

//     } catch (e) {
//         ngx.log(ngx.ERR, 'Error processing PURGE request: ' + e.message);
//         responseHandling(req, 500, 'There was a problem in purging');
//     }
// }



// Main handler for the API
function handleAPI(req) {

    // Determine the resource type and ID from the request
    let requestInfo = handleRequest(req);

    if (!requestInfo) {
        responseHandling(req, 404, `Invalid route`);
        return; // handleRequest already sent a response
    }

    let resourceType = requestInfo.resourceType;
    let resourceId = requestInfo.resourceId;
    let resourceName = requestInfo.resourceName;
    let protocol = requestInfo.protocol;


    if (resourceType == "upstreams"){
        resourceName = ngx.shared[resourceName];
    } else if (resourceType == "certs"){
        ngx.log(ngx.ERR, "check: " + resourceName);
        handleCerts(req, resourceName);
    }

    // Dispatch the request based on the resource type
    if (protocol == 'http' ) {
            handleUpstreams(req, resourceId, resourceName);
    } else if (protocol == 'stream') {
        req.return(200);
    } 
    
}

function handleUpstreams(req, upstreamId, sharedDict) {
    if (!sharedDict){
        responseHandling(req, 404, `Invalid upstream name`);
        return; // handleRequest already sent a response
    }

    let check = count.get(sharedDict);
    // Initialize upstreams if they haven't been loaded yet
    if (check == undefined) {
        transformUpstreams(req, sharedDict);
    }

    if (req.method === 'GET') {
        if (upstreamId) {
            get.handleSingleUpstream(req, upstreamId, sharedDict);
        } else {
            get.handleMultipleUpstreams(req, sharedDict);
        }
    } else if (req.method === 'POST' && !upstreamId) {
        post.addUpstreams(req, sharedDict);
    } else if (req.method === 'DELETE' && upstreamId) {
        del.deleteUpstreams(req, upstreamId, sharedDict);
    } else if ((req.method === 'PUT' || req.method === 'PATCH') && upstreamId) {
        put.editUpstreams(req, upstreamId, sharedDict);
    } else {
        responseHandling(req, 405, 'Method Not Allowed');
    }
}

function handleCerts(req, domainName){
    if (req.method === 'GET') {
        get.listCerts(req, domainName);
    } if (req.method === 'POST') {
        post.addCertificates(req, domainName);
    } else {
        responseHandling(req, 405, 'Method Not Allowed');
    }
}

// Function to transform preloaded upstreams into the shared dictionary
function transformUpstreams(req, upstreamName) {
    try {
        for (var key in preloadedUpstreams) {
            let id = parseInt(key, 10); // Convert key to a number
            let upstream = preloadedUpstreams[key];

            // Validation of the upstream data
            let validation = validate.validatePayload(upstream);
            if (!validation.isValid) {
                responseHandling(req, 400, validation.message);
                return;
            }

            let server = upstream.server;
            let scheme = upstream.scheme || 'http';
            let port = upstream.port || 80;
            let weight = upstream.weight || 1;
            let down = upstream.down || false;
            let route = upstream.route || '';


            // Store the upstream in the shared dictionary
            upstreamName.set(id, JSON.stringify({
                'id': id,
                'scheme': scheme,
                'server': server,
                'port': port,
                'route': route,
                'down': down,
                'weight': weight,
                'endpoint': scheme + '://' + server + ':' + port + route
            }));
        }

        // Mark the ingress as initialized
        count.set(upstreamName.name, 1);
    } catch (e) {
        ngx.log(ngx.ERR, 'Failed to read Upstreams: ' + e.message);
        responseHandling(req, 500, 'Failed to read Upstreams');
    }
}

// Export the module functions
export default {
    handleUpstreamAPI: handleAPI,
    transformUpstreams,
    responseHandling,
};
