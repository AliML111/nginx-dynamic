let count = ngx.shared.count; // Shared dictionary for counting requests and other counters

// Function to add new upstreams
function add_upstreams(req, upstreamName) {
    let payloadData = validate.validate_input(req);
        try {

            if (!payloadData.server) {
                ngx.log(ngx.ERR, 'Server field is empty');
                handler.response_handler(req, 400, 'Server field is empty');
                return;
            }

            // Get the next unique ID for the upstream
            let id = get_next_unique_id(upstreamName);
            
            // Validate the payload data
            let validation = validate.validate_payload(payloadData);
            if (!validation.isValid) {
                handler.response_handler(req, 400, validation.message);
                return;
            }

            // Set default values for missing fields
            payloadData = set_defaults(payloadData);

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

            let stringified = JSON.stringify(payloadData);

            // Store the new upstream in the shared dictionary
            upstreamName.set(id, stringified);

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
function get_next_unique_id(upstreamName) {
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