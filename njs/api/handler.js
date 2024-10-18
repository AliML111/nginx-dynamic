// Import required modules
let count = ngx.shared.count; // Shared dictionary for counting requests and other counters


function request_handler(req) {
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
        const pattern = /^\/api\/v1\/(http|stream)\/(upstreams|certs)\/([^/]+)(?:\/(\d+))?$/;

        // Match the URI against the pattern
        const match = uri.match(pattern);

        if (match) {
            const protocol = match[1];         // 'http' or 'stream'
            const resourceType = match[2];     // 'upstreams' or 'certs'
            const resourceName = match[3];     // 'proxy' or 'example.com'
            const resourceId = match[4] || null; // '1' or null

            // Log the extracted components for debugging
            ngx.log(ngx.INFO, `Protocol: ${protocol}, Resource Type: ${resourceType}, Resource Name: ${resourceName}, Resource ID: ${resourceId}`);

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
        ngx.log(ngx.ERR, `Error in request_handler: ${e.message}`);
        response_handler(req, 500, 'Internal Server Error');
        return;
    }
}


// Function to handle API responses
function response_handler(req, resCode, resMessage, result, result_info) {
    // Set default values if parameters are not provided
    result = (typeof result !== 'undefined') ? result : null;
    result_info = (typeof result_info !== 'undefined') ? result_info : null;
    let req_id = req.variables.request_id;

    // Construct the response object
    let output = {
        success: resCode >= 200 && resCode < 300,
        errors: resCode >= 400 ? resMessage : "",
        message: resCode >= 200 && resCode < 300 ? resMessage : "",
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
//         load_upstreams(req);
//         response_handler(req, 204, 'Purged');

//     } catch (e) {
//         ngx.log(ngx.ERR, 'Error processing PURGE request: ' + e.message);
//         response_handler(req, 500, 'There was a problem in purging');
//     }
// }



// Main handler for the API
function api_handler(req) {

    // Determine the resource type and ID from the request
    let requestInfo = request_handler(req);

    if (!requestInfo) {
        response_handler(req, 404, `Invalid route`);
        return; // request_handler already sent a response
    }

    let resourceType = requestInfo.resourceType;
    let resourceId = requestInfo.resourceId;
    let resourceName = requestInfo.resourceName;
    let protocol = requestInfo.protocol;


    if (resourceType == "upstreams"){
        resourceName = ngx.shared[resourceName];
    } else if (resourceType == "certs"){
        req.return(500, "Not implemented yet");
    }

    // Dispatch the request based on the resource type
    if (protocol == 'http' ) {
            upstreams_handler(req, resourceId, resourceName);
    } else if (protocol == 'stream') {
        req.return(200);
    } 
    
}

function upstreams_handler(req, upstreamId, sharedDict) {
    if (!sharedDict){
        response_handler(req, 404, `Invalid upstream name`);
        return; // request_handler already sent a response
    }

    let check = count.get(sharedDict);
    // Initialize upstreams if they haven't been loaded yet
    if (check == undefined) {
        load_upstreams(req, sharedDict);
        ngx.log(ngx.INFO, "Read from fs");
    }

    if (req.method === 'GET') {
        if (upstreamId) {
            get.list_single_upstream(req, upstreamId, sharedDict);
        } else {
            get.list_multiple_upstreams(req, sharedDict);
        }
    } else if (req.method === 'POST' && !upstreamId) {
        post.add_upstreams(req, sharedDict);
    } else if (req.method === 'DELETE') {
        del.delete_upstreams(req, upstreamId, sharedDict);
    } else if ((req.method === 'PUT' || req.method === 'PATCH') && upstreamId) {
        put.edit_upstreams(req, upstreamId, sharedDict);
    } else {
        response_handler(req, 405, 'Method Not Allowed');
    }
}

// Function to transform preloaded upstreams into the shared dictionary
function load_upstreams(req, upstreamName) {
    try {
        for (let key in preloadedUpstreams) {
            let id = parseInt(key, 10); // Convert key to a number
            let upstream = preloadedUpstreams[key];

            // Validation of the upstream data
            let validation = validate.validate_payload(upstream);
            if (!validation.isValid) {
                response_handler(req, 400, validation.message);                
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
        count.set(upstreamName, 1);

        // Set next_id to keep counting for number of upstreams used in POST
        count.set('next_id', (upstreamName.size() - 1));
    } catch (e) {
        ngx.log(ngx.ERR, 'Failed to read Upstreams: ' + e.message);
        response_handler(req, 500, 'Failed to read Upstreams');
        return;
    }
}

// Export the module functions
export default {
    api_handler: api_handler,
    load_upstreams,
    response_handler,
};
