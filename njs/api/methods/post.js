var fs = require('fs');

// Function to add new upstreams
function add_upstreams(req, upstreamName, count, stream) {
    let payloadData = validate.validate_input(req);
        try {

            if (!payloadData.server) {
                ngx.log(ngx.ERR, 'Server field is empty');
                handler.response_handler(req, 400, 'Server field is empty');
                return;
            }

            // Get the next unique ID for the upstream
            let id = get_next_unique_id(upstreamName, count);
            
            // Validate the payload data
            let validation = validate.validate_payload(payloadData, stream);
            if (!validation.isValid) {
                handler.response_handler(req, 400, validation.message);
                return;
            }

            // Set default values for missing fields
            payloadData = set_defaults(payloadData);

            // Construct the upstream data object
            payloadData = {
                'id': id,
                // Conditionally set scheme and route based on the value of stream
                'scheme': stream === 1 ? undefined : payloadData.scheme,  // If stream is 1, scheme will be undefined
                'server': payloadData.server,
                'port': payloadData.port,
                'route': stream === 1 ? undefined : payloadData.route,    // If stream is 1, route will be undefined
                'down': payloadData.down,
                'weight': payloadData.weight,
                // Conditionally construct endpoint based on whether scheme is defined
                'endpoint': stream === 1 
                ? payloadData.server + ':' + payloadData.port  // Only server:port for stream
                : payloadData.scheme + '://' + payloadData.server + ':' + payloadData.port + (payloadData.route ? payloadData.route : '')
            };

            let stringified = JSON.stringify(payloadData);

            // Store the new upstream in the shared dictionary
            upstreamName.set(id, stringified);

            disk.writeFile(req, upstreamName);

            ngx.fetch('http://unix:/etc/nginx/dummy.sock');

            if (upstreamName.get(id) == stringified){
                handler.response_handler(req, 200, "Upstream created successfully", payloadData, null);
            } else {
                handler.response_handler(req, 500, "Something went wrong", null, null);
                return;
            }

        } catch (e) {
            ngx.log(ngx.ERR, 'Error processing POST request: ' + e.message);
            handler.response_handler(req, 500, 'Could not add upstream');
            return;
        }
}

// Function to get the next unique ID
function get_next_unique_id(upstreamName, count) {
    let id;
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
function set_defaults(payload) {
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
    add_upstreams
}