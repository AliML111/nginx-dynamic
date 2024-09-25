const proxy = ngx.shared.proxy;
// let id = 0;
const count = ngx.shared.count;
// let upstreamId;
function getUpstream(req) {
    const ingress_name = req.variables['ingress_service'];
    
    // Initialize upstreams for this ingress if they haven't been loaded yet
    if (!count.get(ingress_name)) {
        transformUpstreams(req);
    }

    // Get the list of upstreams from the shared dictionary
    const items = proxy.items();
    const numUpstreams = items.length;

    // Return error if no upstreams available
    if (numUpstreams == 0) {
        invalidBackend(req, 503);
        return;
    }

    // Initialize roundRobinIndex and weight counter
    let roundRobinIndex = count.get('index') || 0;
    let weightCounter = count.get('weight') || 0;
    let attempts = count.get('attempts') || 0;


    // Failsafe for loop
    if (roundRobinIndex >= numUpstreams) {
        roundRobinIndex = 0;
    }    

    // Get the backend for the current round-robin index
    let currentItem = JSON.parse(items[roundRobinIndex][1]);
    let backend = currentItem.endpoint;
    let backendWeight = currentItem.weight;
    let backendState = currentItem.down;

    while (backendState && attempts < numUpstreams) {
        roundRobinIndex = (roundRobinIndex + 1) % numUpstreams;
        currentItem = JSON.parse(items[roundRobinIndex][1]);
        backend = currentItem.endpoint;
        backendWeight = currentItem.weight;
        backendState = currentItem.down;
        attempts++;
        count.set('attempts', attempts);
    }

    if (attempts === numUpstreams) {
        invalidBackend(req, 503);
        return;
    }

    if (attempts != 0){
        count.set('attempts', 0);
    }

    // Increment the weight counter
    weightCounter++;

    ngx.log(ngx.ERR, `Selected backend: ${backend} at index: ${roundRobinIndex}, weight counter: ${weightCounter}, backend weight: ${backendWeight}`);

    // If the weight counter equals the backend weight, reset and move to the next backend
    if (weightCounter >= backendWeight) {
        weightCounter = 0;  // Reset the weight counter
        roundRobinIndex = (roundRobinIndex + 1) % numUpstreams;  // Increment the index using modulo
    }

    // Store the updated values back in the shared dictionary
    count.set('index', roundRobinIndex);
    count.set('weight', weightCounter);

    // Return the selected backend
    return backend;
}

function invalidBackend(req, code) {
    req.return(code, "Invalid Backend");
    req.finish();
    return "@invalidbackend";
}

function handleRequest(req) {
    // Get the complete URI
    let uri = req.uri;
    let upstreamId;
    // Check if the URI ends with a slash
    if (!uri.endsWith('/')) {
        // If it doesn't, add the trailing slash
        uri += '/';
        // ngx.log(ngx.ERR, 'Added trailing slash: ' + uri);
    }

    // Use regex to extract the ID from any URL that ends with /<id>/
    const match = uri.match(/\/(\d+)\/$/);

    // If a match is found, extract the numeric ID
    if (match && match[1]) {
        upstreamId = match[1];  // This will be the numeric ID
        ngx.log(ngx.INFO, 'Extracted Upstream ID: ' + upstreamId);

        // Now you can handle the upstreamId (fetch from shared dictionary, etc.)
        // req.return(200, 'Upstream ID: ' + upstreamId);
    } 
    return upstreamId;
}

function responseHandling (req, resCode, resMessage){
       let req_id = req.variables.request_id;
       let output = {
            error: {
            status: resCode,
            text: resMessage
            },
            request_id: req_id
        };
    req.return(resCode, JSON.stringify(output));
    req.finish();
}

function listUpstreams (req) {
        try {
            // if(id){
                // upstreamId = serverId;
            // }
            const upstreamId = handleRequest(req);
            if (upstreamId){
                if (!proxy.get(upstreamId)){
                    responseHandling(req, 404, 'Upstream not found!');
                    return;
                }
                let parsedServer =  JSON.parse(proxy.get(upstreamId));
                req.return(200, JSON.stringify(parsedServer));

            } else {
                // Return the sorted keys as a response
                // let id = countKeys(req);
                let output = [];
                let items = proxy.items();
                for (let i in items){
                    let parsedServer = JSON.parse(items[i][1]);
                    output.push(parsedServer);
                }
                req.return(200, JSON.stringify(output, null, 2));

            } 

        } catch (e) {
            ngx.log(ngx.ERR, 'Failed to list Upstreams: ' + e.message);
            responseHandling(req, 500, 'Failed to list Upstreams');
        }
}
function addUpstreams (req) {
    const requestBody = req.requestBuffer;
    let id = countKeys(req);
        if (requestBody) {
            try {
                let payloadData;
                try {
                // Parse the request body as JSON
                payloadData = JSON.parse(requestBody);
                } catch(e){
                    ngx.log(ngx.ERR, 'Invalid JSON: ' + e.message);
                    responseHandling(req, 400, 'Invalid JSON');
                    return;
                }
                let key = id++;

                if ( proxy.get(key) != undefined ) {
                    responseHandling(req, 409, `This id: ${key} already exists!`);
                    return;
                }

                const server = payloadData.server;
                // const validation = validateAndResolveDomain(server);
                if (!server) {
                    responseHandling(req, 400, 'server field is empty');
                    return;
                }

                let weight = payloadData.weight;
                if (!weight) {
                    weight = 1;
                }
                
                let down = payloadData.down;
                if (!down){
                    down = false;
                }

                let scheme = payloadData.scheme;
                if (!scheme){
                    scheme = "http";
                }

                let port = payloadData.port;
                if (!port){
                    port = 80;
                }

                // Validate that only "server", "down", and "weight" fields are provided
                const allowedKeys = ['server', 'down', 'weight', 'scheme', 'port'];
                const payloadKeys = Object.keys(payloadData);

                for (let i in payloadKeys ) {
                    if (!allowedKeys.includes(payloadKeys[i])) {
                        responseHandling(req, 400, `Invalid key provided: ${payloadKeys[i]}`);
                        return;
                    }
                }

                // Validate server
                if (server && !validateServer(server)) {
                    responseHandling(req, 400, `Invalid server: ${server}`);
                    return;
                }

                // Validate port
                if (port && !validatePort(port)) {
                    responseHandling(req, 400, `Invalid port: ${port}`);
                    return;
                }

                // Validate scheme
                if (scheme && !validateScheme(scheme)) {
                    responseHandling(req, 400, `Invalid scheme: ${scheme}`);
                    return;
                }

                if (down && ![false, true].includes(down)) {
                    responseHandling(req, 400, `Invalid value ${down} for "down"`);
                    return;
                }
    
                if (weight && (typeof weight != 'number' || weight <= 0)) {
                    responseHandling(req, 400, `Invalid value ${weight} for "weight"`);
                    return;
                }

                proxy.set(key, JSON.stringify({"id": key, "scheme": scheme, "server": server, "port": port, "down": down, "weight": weight, "endpoint": `${scheme}://${server}:${port}`}));
                
                let items = {
                    id: key,
                    server:  JSON.parse(proxy.get(key)).server,
                    down: down,
                    weight:  JSON.parse(proxy.get(key)).weight 
                }
                req.return(200, JSON.stringify(items));
                        

                // writeConfig(req);  // Save to file after deletion
                
            } catch (e) {
                ngx.log(ngx.ERR, 'Error processing POST request: ' + e.message);
                responseHandling(req, 500, 'Could not add upstream');
            }
        } else {
            responseHandling(req, 400, 'Data not provided');
            return;
        }
}

function deleteUpstreams (req) {
    const requestBody = req.requestBuffer;
    const upstreamId = handleRequest(req);
        if (requestBody || upstreamId) {
            try {

                let key = upstreamId;

                if ( proxy.get(key) == undefined ) {
                    responseHandling(req, 404, `Such an id: ${key} does not exist`);
                    return;
                }

                proxy.delete(key);
                if ( proxy.get(key) == undefined ) {
                    responseHandling(req, 204, 'Deleted');
                } else {
                    ngx.log(ngx.ERR, 'Failed to delete upstream with key: ' + key );
                    responseHandling(req, 500, 'Failed to delete upstream');
                }
                    
                // writeConfig(req);  // Save to file after deletion
                
            } catch (e) {
                ngx.log(ngx.ERR, 'Error processing DELETE request: ' + e.message);
                responseHandling(req, 415, 'Invalid JSON provided');
                return;
            }
        } else {
            responseHandling(req, 415, 'Invalid JSON provided');
            return;
        }
}

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

function editUpstreams(req) {
    const requestBody = req.requestBuffer;
    const upstreamId = handleRequest(req);
    if (requestBody && upstreamId) {
        try {
            let payloadData;
            try {
            // Parse the request body as JSON
            payloadData = JSON.parse(requestBody);
            } catch(e){
                ngx.log(ngx.ERR, 'Invalid JSON: ' + e.message);
                responseHandling(req, 400, 'Invalid JSON');
                return;
            }

            // if (payloadData.length == undefined){
            //     listUpstreams (req, upstreamId);
            //     return;
            // }

            let key = upstreamId;
            const weight = payloadData.weight;
            const server = payloadData.server;
            const down = payloadData.down;
            const scheme = payloadData.scheme;
            const port = payloadData.port;

            if (proxy.get(key) == undefined) {
                responseHandling(req, 404, `This id ${key} does not exist`);
                return;
            }

            // Validate that only "server", "down", and "weight" fields are provided
            const allowedKeys = ['server', 'down', 'weight', 'scheme', 'port'];
            const payloadKeys = Object.keys(payloadData);

            for (let i in payloadKeys ) {
                if (!allowedKeys.includes(payloadKeys[i])) {
                    responseHandling(req, 400, `Invalid key provided: ${payloadKeys[i]}`);
                    return;
                }
            }

            // Validate server
            if (server && !validateServer(server)) {
                responseHandling(req, 400, `Invalid server: ${server}`);
                return;
            }

            // Validate port
            if (port && !validatePort(port)) {
                responseHandling(req, 400, `Invalid port: ${port}`);
                return;
            }

            // Validate scheme
            if (scheme && !validateScheme(scheme)) {
                responseHandling(req, 400, `Invalid scheme: ${scheme}`);
                return;
            }

            if (down && ![false, true].includes(down)) {
                responseHandling(req, 400, `Invalid value ${down} for "down"`);
                return;
            }

            if (weight && (typeof weight != 'number' || weight <= 0)) {
                responseHandling(req, 400, `Invalid value ${weight} for "weight"`);
                return;
            }
            
            const existingData = JSON.parse(proxy.get(key));
            // Manually merge existing data with the provided fields using Object.assign
            const updatedData = Object.assign({}, existingData, payloadData);

            updatedData.endpoint = `${updatedData.scheme}://${updatedData.server}:${updatedData.port}`;

            proxy.set(key, JSON.stringify(updatedData));

            listUpstreams (req);
            return;
            

        } catch (e) {
            ngx.log(ngx.ERR, 'Error processing PATCH request: ' + e.message);
            responseHandling(req, 500, 'Could not edit upstream');
        }
    } else {
        responseHandling(req, 400, 'Data not provided');
        return;
    }
}

function handleUpstreamAPI(req) {
    let ingress_name = req.variables['ingress_service'];
    let check = count.get(ingress_name);
    if (check == undefined){
        transformUpstreams(req);
    }
    const upstreamId = handleRequest(req);
    if (req.method === 'GET') {
        listUpstreams (req);
    } else if (req.method === 'POST' && !upstreamId) {
        addUpstreams(req);
    } else if (req.method === 'DELETE' && upstreamId) {
        deleteUpstreams(req);
    } else if (req.method === 'PURGE' && !upstreamId) {
        purgeSharedDict(req);
    } else if (req.method === 'PUT' && upstreamId) {
        editUpstreams(req);
    }
    else {
        responseHandling(req, 405, 'Method Not Allowed');
    }
}

function countKeys(req) {
    
    try {

        let id = proxy.size();
        return id;

    } catch (e) {
        ngx.log(ngx.ERR, "Failed to count Upstreams: " + e.message);
        responseHandling(req, 500, 'Failed to count Upstreams');
        return
    }
    
    
}


function validateServer(server) {
    

    // Regular expressions for domain, IPv4, and IPv6 validation
    const domainPattern = /^(?!:\/\/)([a-zA-Z0-9-_]+\.)+[a-zA-Z]{2,}$/;  // Simple domain name validation
    const ipv4Pattern = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;  // IPv4 address validation
    const ipv6Pattern = /^([a-fA-F0-9]{1,4}:){7,7}[a-fA-F0-9]{1,4}|([a-fA-F0-9]{1,4}:){1,7}:|([a-fA-F0-9]{1,4}:){1,6}:[a-fA-F0-9]{1,4}|([a-fA-F0-9]{1,4}:){1,5}(:[a-fA-F0-9]{1,4}){1,2}|([a-fA-F0-9]{1,4}:){1,4}(:[a-fA-F0-9]{1,4}){1,3}|([a-fA-F0-9]{1,4}:){1,3}(:[a-fA-F0-9]{1,4}){1,4}|([a-fA-F0-9]{1,4}:){1,2}(:[a-fA-F0-9]{1,4}){1,5}|[a-fA-F0-9]{1,4}:((:[a-fA-F0-9]{1,4}){1,6})|:((:[a-fA-F0-9]{1,4}){1,7}|:)$/;  // IPv6 address validation
    
    // Validate server
    if (!(domainPattern.test(server) || ipv4Pattern.test(server) || ipv6Pattern.test(server)) || server == "") {
        return false;
    }
    
    return true;
}

function validatePort(port){
     // Validate port (optional, allow null for defaults)
     if (port && (isNaN(port) || port <= 0 || port > 65535)) {
        return false;
    }
    return true;
}

function validateScheme(scheme){
    // Validate scheme (http or https)
    if (!['http', 'https'].includes(scheme) || scheme == "") {
        return false;
    }
    return true;
}

function transformUpstreams(req) {
    let weight;
    let down;
    let scheme;
    let port;
    try {
        for (let key in preloadedUpstreams) {
                let upstream = preloadedUpstreams[key];
                let  server = upstream.server;
                scheme = upstream.scheme;
                port = upstream.port;
                weight =  upstream.weight;
                down = upstream.down;
                if (!down){
                    down = false;
                }
                if (!weight){
                    weight = 1;
                }
                if (!scheme){
                    scheme = "http";
                }
                if (!port){
                    port = 80;
                }

                // Validate that only "server", "down", and "weight" fields are provided
                const allowedKeys = ['server', 'down', 'weight', 'scheme', 'port'];
                const payloadKeys = Object.keys(upstream);

                for (let i in payloadKeys ) {
                    if (!allowedKeys.includes(payloadKeys[i])) {
                        responseHandling(req, 400, `Invalid key provided: ${payloadKeys[i]} during loading upstreams`);
                        return;
                    }
                }

                // Validate server
                if (!validateServer(server)) {
                    responseHandling(req, 400, `Invalid server: ${server}`);
                    return;
                }

                // Validate port
                if (!validatePort(port)) {
                    responseHandling(req, 400, `Invalid port: ${port}`);
                    return;
                }

                // Validate scheme
                if (!validateScheme(scheme)) {
                    responseHandling(req, 400, `Invalid scheme: ${scheme}`);
                    return;
                }

                proxy.set(key, JSON.stringify({"id": key, "scheme": scheme, "server": server, "port": port, "down": down, "weight": weight, "endpoint": `${scheme}://${server}:${port}`}));
        }
        const ingress_name = req.variables['ingress_service'];
        count.set(ingress_name, 1);
    } catch(e){
        ngx.log(ngx.ERR, "Failed to read Upstreams: " + e.message);
        responseHandling(req, 500, 'Failed to read Upstreams');
    }
}


    
export default {
    getUpstream,
    handleUpstreamAPI
};