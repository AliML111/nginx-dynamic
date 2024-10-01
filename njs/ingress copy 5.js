const proxy = ngx.shared.proxy;
const count = ngx.shared.count;

// Module-level variables
// var nodes = {}; // Stores nodes with their weights and state
// var totalWeight = 0; // Sum of all node weights
// var currentWeights = {}; // Stores current weights for the smooth algorithm

// function initBalancer() {
//     nodes = {};
//     currentWeights = {};
//     totalWeight = 0;

//     const items = proxy.items();
//     for (let i = 0; i < items.length; i++) {
//         const currentItem = JSON.parse(items[i][1]);
//         const id = currentItem.id;
//         const weight = currentItem.weight;
//         const endpoint = currentItem.endpoint;

//         nodes[id] = {
//             id: id,
//             endpoint: endpoint,
//             weight: weight,
//             down: currentItem.down || false,
//         };
//         currentWeights[id] = 0;
//         totalWeight += weight;
//     }

//     randomStart();
// }

// function randomStart() {
//     const nodeIds = Object.keys(nodes);
//     const count = nodeIds.length;
//     const randomTimes = Math.floor(Math.random() * count);

//     for (let i = 0; i < randomTimes; i++) {
//         findNextNode();
//     }
// }

// function findNextNode() {
//     let bestNodeId = null;
//     let bestCurrentWeight = -Infinity;

//     for (const id in nodes) {
//         const node = nodes[id];
//         if (node.down) {
//             continue; // Skip nodes marked as down
//         }

//         // Increase current weight by node's weight
//         currentWeights[id] += node.weight;

//         // Select node with the highest current weight
//         if (currentWeights[id] > bestCurrentWeight) {
//             bestCurrentWeight = currentWeights[id];
//             bestNodeId = id;
//         }
//     }

//     if (bestNodeId !== null) {
//         // Decrease the current weight of the selected node by total weight
//         currentWeights[bestNodeId] -= totalWeight;
//         return nodes[bestNodeId];
//     } else {
//         return null; // No available nodes
//     }
// }

// function getUpstream(req) {
//     // Ensure the balancer is initialized
//     if (Object.keys(nodes).length === 0) {
//         initBalancer();
//     }

//     const selectedNode = findNextNode();

//     if (!selectedNode) {
//         invalidBackend(req, 503);
//         return;
//     }

//     // Increment request counter for the selected backend
//     count.incr(selectedNode.endpoint, 1, 0);
//     let reqCounter = count.get(selectedNode.endpoint);

//     ngx.log(ngx.ERR, `Selected backend: ${selectedNode.endpoint}, current weight: ${currentWeights[selectedNode.id]}, number of reqs: ${reqCounter}`);

//     // Return the selected backend's endpoint
//     return selectedNode.endpoint;
// }

// function invalidBackend(req, code) {
//     req.return(code, "Invalid Backend");
//     req.finish();
//     return "@invalidbackend";
// }

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
    if (numUpstreams === 0) {
        invalidBackend(req, 503);
        return;
    }

    // Atomic operation to retrieve and increment index and weight in one step
    const indexKey = `index`;
    const weightKey = `weight`;

    let roundRobinIndex = count.incr(indexKey, 1, 0) % numUpstreams;
    let weightCounter = count.incr(weightKey, 1, 0);
    let currentItem = JSON.parse(items[roundRobinIndex][1]);

    let backend = currentItem.endpoint;
    let backendWeight = currentItem.weight;
    count.incr(backend, 1, 0); // Increment request count for the backend
    let reqCounter = count.get(backend);

    // Reset weight counter if it exceeds the backend weight
    if (weightCounter >= backendWeight) {
        count.set(weightKey, 0);
    }

    ngx.log(ngx.ERR, `Selected backend: ${backend} at index: ${roundRobinIndex}, weight counter: ${weightCounter}, backend weight: ${backendWeight}, number of reqs: ${reqCounter}`);

    // Return the selected backend
    return backend;
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

function listUpstreams(req) {
    try {
        const upstreamId = handleRequest(req);
        if (upstreamId) {
            if (!proxy.get(upstreamId)) {
                responseHandling(req, 404, 'Upstream not found!');
                return;
            }
            let parsedServer = JSON.parse(proxy.get(upstreamId));
            parsedServer.requests = count.get(parsedServer.endpoint) || 0;
            req.return(200, JSON.stringify(parsedServer));

        } else {
            // Collect all upstreams
            let output = [];
            let items = proxy.items();
            for (let i in items) {
                let parsedServer = JSON.parse(items[i][1]);
                parsedServer.requests = count.get(parsedServer.endpoint) || 0;
                output.push(parsedServer);
            }

            // Sort output based on parsedServer.id in ascending order
            output.sort((a, b) => {
                return a.id - b.id;
            });

            // Return the sorted output
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

                // Validation
                const validation = validatePayload(payloadData);
                if (!validation.isValid) {
                    responseHandling(req, 400, validation.message);
                    return;
                }

                // Proceed to save valid data
                const server = payloadData.server;
                let weight = payloadData.weight || 1;
                let down = payloadData.down || false;
                let scheme = payloadData.scheme || "http";
                let port = payloadData.port || 80;

                let items = {"id": key, "scheme": scheme, "server": server, "port": port, "down": down, "weight": weight, "endpoint": `${scheme}://${server}:${port}`};

                proxy.set(key, JSON.stringify(items));
                
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

            let key = upstreamId;

            // Validation
            const validation = validatePayload(payloadData);
            if (!validation.isValid) {
                responseHandling(req, 400, validation.message);
                return;
            }

            const existingData = JSON.parse(proxy.get(key));
            // Manually merge existing data with the provided fields using Object.assign
            const updatedData = Object.assign({}, existingData, payloadData);

            updatedData.endpoint = `${updatedData.scheme}://${updatedData.server}:${updatedData.port}`;

            proxy.set(key, JSON.stringify(updatedData));

            req.return(200, JSON.stringify(updatedData));
            

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

function validatePayload(payloadData) {
    const allowedKeys = ['server', 'down', 'weight', 'scheme', 'port'];
    // Check for any invalid keys in the payload
    const payloadKeys = Object.keys(payloadData);
    for (let i in payloadKeys) {
        if (!allowedKeys.includes(payloadKeys[i])) {
            return { isValid: false, message: `Invalid key provided: ${payloadKeys[i]}` };
        }
    }

    // Validate server (string)
    if (payloadData.server && (typeof payloadData.server !== 'string' || !validateServer(payloadData.server))) {
        return { isValid: false, message: `Invalid server: ${payloadData.server}` };
    }

    // Validate port (integer within 1-65535)
    if (payloadData.port && !validatePort(payloadData.port)) {
        return { isValid: false, message: `Invalid port: ${payloadData.port}` };
    }

    // Validate scheme (string)
    if (payloadData.scheme && !validateScheme(payloadData.scheme)) {
        return { isValid: false, message: `Invalid scheme: ${payloadData.scheme}` };
    }

    // Validate down (boolean)
    if (payloadData.down !== undefined && !validateDown(payloadData.down)) {
        return { isValid: false, message: `Invalid value ${payloadData.down} for "down"` };
    }

    // Validate weight (positive number)
    if (payloadData.weight && !validateWeight(payloadData.weight)) {
        return { isValid: false, message: `Invalid value ${payloadData.weight} for "weight"` };
    }

    return { isValid: true };
}


function validateDown(down) {
    return typeof down == 'boolean';
}

function validateWeight(weight) {
    return typeof weight == 'number' && Number.isInteger(weight) && weight > 0;
}

function validateServer(server) {
    if (typeof server != 'string') {
        return false;  // Ensure the server is a string
    }

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

function validatePort(port) {
    // Ensure the port is a number and within the valid range (1-65535)
    return typeof port === 'number' && Number.isInteger(port) && port > 0 && port <= 65535;
}


function validateScheme(scheme){
    return typeof scheme === 'string' && ['http', 'https'].includes(scheme);
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
                scheme = upstream.scheme || "http";
                port = upstream.port || 80;
                weight =  upstream.weight || 1;
                down = upstream.down || false;

                // Validation
                const allowedKeys = ['server', 'down', 'weight', 'scheme', 'port'];
                const validation = validatePayload(upstream, allowedKeys);
                if (!validation.isValid) {
                    responseHandling(req, 400, validation.message);
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