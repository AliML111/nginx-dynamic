function validate_input(req){
    let requestBody = req.requestBuffer;
    if (!requestBody || requestBody.length == 0) {
        handler.response_handler(req, 400, 'Data not provided');
        return;
    }
    try {
        if (req.headersIn['Content-Type'] != 'application/json'){
            ngx.log(ngx.ERR, 'Content-Type is not JSON');
            handler.response_handler(req, 400, 'Content-Type is not JSON');
            return;
        }
        // Parse the request body as JSON
        requestBody = JSON.parse(requestBody);

        if (requestBody.length != undefined){
            ngx.log(ngx.ERR, 'nested object or list');
            handler.response_handler(req, 400, 'nested object or list');
            return;
        }
        return requestBody;


    } catch (e) {
        ngx.log(ngx.ERR, 'Invalid JSON: ' + e.message);
        handler.response_handler(req, 400, 'Invalid JSON');
        return;
    }
}

// Function to validate payload data
function validate_payload(payloadData) {

    let allowedKeys = ['server', 'down', 'weight', 'scheme', 'port', 'route'];

    // Check for any invalid keys in the payload
    let payloadKeys = Object.keys(payloadData);
    for (let i in payloadKeys) {
        if (allowedKeys.indexOf(payloadKeys[i]) === -1) {
            return { isValid: false, message: 'Invalid field provided: ' + payloadKeys[i] + ' in config file or request'};
        }
    }

    // Validate 'server' field (should be a valid server address)
    if (payloadData.server != null && !validate_server(payloadData.server)) {
        return { isValid: false, message: `Invalid value for server: "${payloadData.server}"` };
    }

    // Validate 'port' field (should be an integer between 1 and 65535)
    if (payloadData.port != null && !validate_port(payloadData.port)) {
        return { isValid: false, message: `Invalid value for port: "${payloadData.port}"` };
    }

    // Validate 'scheme' field (should be 'http' or 'https')
    if (payloadData.scheme != null && !validate_scheme(payloadData.scheme)) {
        return { isValid: false, message: `Invalid value for scheme: "${payloadData.scheme}"` };
    }

    // Validate 'down' field (should be a boolean)
    if (payloadData.down != null && !validate_down(payloadData.down)) {
        return { isValid: false, message: `Invalid value for down: "${payloadData.down}"` };
    }

    // Validate 'weight' field (should be a positive integer)
    if (payloadData.weight != null && !validate_weight(payloadData.weight)) {
        return { isValid: false, message: `Invalid value for weight: "${payloadData.weight}"` };
    }

    // Validate 'route' field 
    if (payloadData.route != null && !validate_route(payloadData.route)) {
        return { isValid: false, message: `Invalid value for route: "${payloadData.route}"` };
    }

    return { isValid: true };
}

// Validation helper functions

// Validate the 'down' field (boolean)
function validate_down(down) {
    return typeof down === 'boolean';
}

// Validate the 'weight' field (positive integer)
function validate_weight(weight) {
    return typeof weight === 'number' && (weight % 1 === 0) && weight > 0;
}

// Validate the 'server' field (valid domain or IP address)
function validate_server(server) {
    if (typeof server != 'string') {
        return false; // Ensure the server is a string
    }

    // Regular expressions for domain, IPv4, and IPv6 validation
    let domainPattern = /^(?!:\/\/)([a-zA-Z0-9-_]+\.)+[a-zA-Z]{2,}$/; // Simple domain name validation
    let ipv4Pattern = /^((25[0-5]|2[0-4]\d|[01]?\d\d?)(\.|$)){4}$/; // IPv4 address validation
    let ipv6Pattern = /^([a-fA-F0-9]{1,4}:){7}[a-fA-F0-9]{1,4}$/; // Simplified IPv6 validation
    let unixSocketPattern = /^unix:\/[\w\/\-\.]+$/;                   // Unix socket path validation (e.g., unix:/path/to/socket)

    // Validate the server against the patterns
    return domainPattern.test(server) || ipv4Pattern.test(server) || ipv6Pattern.test(server) || unixSocketPattern.test(server);
}

// Validate the 'port' field (integer between 1 and 65535)
function validate_port(port) {
    return typeof port === 'number' && (port % 1 === 0) && port > 0 && port <= 65535;
}

// Validate the 'scheme' field ('http' or 'https')
function validate_scheme(scheme) {
    return typeof scheme === 'string' && (scheme === 'http' || scheme === 'https');
}

function validate_route(route) {
    return typeof route === 'string' && (route === "" || route.startsWith("/"));
}

// Export the module functions
export default {
    validate_input,
    validate_payload
};