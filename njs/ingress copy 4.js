const proxy = ngx.shared.proxy;
let id = 0;
const count = ngx.shared.count;
// let roundRobinIndex;
let upstreamId;
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


    // Failsafe for loop
    if (roundRobinIndex >= numUpstreams) {
        roundRobinIndex = 0;
    }    

    // Get the backend for the current round-robin index
    let currentItem = JSON.parse(items[roundRobinIndex][1]);
    let backend = currentItem.server.trim();
    let backendWeight = currentItem.weight;
    let backendState = currentItem.down;

    while (backendState == true) {
        roundRobinIndex = (roundRobinIndex + 1) % numUpstreams;
        currentItem = JSON.parse(items[roundRobinIndex][1]);
        backend = currentItem.server.trim();
        backendWeight = currentItem.weight;
        backendState = currentItem.down;
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

function listUpstreams (req, serverId) {
        try {
            if(id){
                upstreamId = serverId;
            }
            if (upstreamId){
                if (!proxy.get(upstreamId)){
                    responseHandling(req, 404, 'Upstream not found!');
                    return;
                }
                let parsedServer =  JSON.parse(proxy.get(upstreamId));
                req.return(200, JSON.stringify(parsedServer));

            } else {
                // Return the sorted keys as a response
                countKeys(req);
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
    countKeys(req);
        if (requestBody) {
            try {
                // Parse the request body as JSON
                const payloadData = JSON.parse(requestBody);
                let key = id++;

                if ( proxy.get(key) != undefined ) {
                    responseHandling(req, 409, 'This id already exists!');
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

                proxy.set(key, JSON.stringify({"id": key, "server": server.trim(), "down": down, "weight": weight }));
                
                let items = {
                    id: key,
                    server:  JSON.parse(proxy.get(key)).server.trim(),
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
        if (requestBody || upstreamId) {
            try {

                let key = upstreamId;

                if ( proxy.get(key) == undefined ) {
                    responseHandling(req, 404, 'Such an id does not exist');
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
    
    if (requestBody && upstreamId) {
        try {
            
            // Parse the request body as JSON
            const payloadData = JSON.parse(requestBody);

            // if (payloadData.length == undefined){
            //     listUpstreams (req, upstreamId);
            //     return;
            // }

            let key = upstreamId;

            if (proxy.get(key) == undefined) {
                responseHandling(req, 404, 'This id does not exist');
                return;
            }

            // Validate that only "server", "down", and "weight" fields are provided
            const allowedKeys = ['server', 'down', 'weight'];
            const payloadKeys = Object.keys(payloadData);

            for (let i in payloadKeys ) {
                if (!allowedKeys.includes(payloadKeys[i])) {
                    responseHandling(req, 400, `Invalid key provided: ${payloadKeys[i]}`);
                    return;
                }
            }

            // Further validation (optional): Check the types and values of "server", "down", and "weight"
            if (payloadData.server && (payloadData.server.trim() == '')) {
                responseHandling(req, 400, 'Invalid value for "server"');
                return;
            }

            if (payloadData.down && ![false, true].includes(payloadData.down)) {
                responseHandling(req, 400, 'Invalid value for "down"');
                return;
            }

            if (payloadData.weight && (typeof payloadData.weight !== 'number' || payloadData.weight <= 0)) {
                responseHandling(req, 400, `Invalid value ${payloadData.weight} for "weight"`);
                return;
            }
            const existingData = JSON.parse(proxy.get(key));
            // Manually merge existing data with the provided fields using Object.assign
            const updatedData = Object.assign({}, existingData, payloadData);

            proxy.set(key, JSON.stringify(updatedData));

            listUpstreams (req, upstreamId);
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
    handleRequest(req);
    if (req.method === 'GET') {
        listUpstreams (req);
    } else if (req.method === 'POST' && !upstreamId) {
        addUpstreams(req);
    } else if (req.method === 'DELETE' && upstreamId) {
        deleteUpstreams(req);
    } else if (req.method === 'PURGE' && !upstreamId) {
        purgeSharedDict(req);
    } else if (req.method === 'PATCH' && upstreamId) {
        editUpstreams(req);
    }
    else {
        responseHandling(req, 405, 'Method Not Allowed');
    }
}

function countKeys(req) {
    
    try {

        id = proxy.size();

    } catch (e) {
        ngx.log(ngx.ERR, "Failed to count Upstreams: " + e.message);
        responseHandling(req, 500, 'Failed to count Upstreams');
    }
    
    
}

function resolveDomain(domain) {
    const url = `https://dns.google/resolve?name=${domain}&type=ANY`;  // Request both A and AAAA records

    // Perform the fetch request
    return ngx.fetch(url, {
        method: 'GET',
        headers: {
            'Accept': 'application/dns-json'
        }
    }).then(function(response) {
        if (!response.ok) {
            throw new Error('DNS query failed with status ' + response.status);
        }

        // Parse the response as JSON
        return response.json();
    }).then(function(dnsResponse) {
        return dnsResponse;
    }).catch(function(error) {
        ngx.log(ngx.ERR, 'Failed to resolve domain: ' + error.message);
        return null;
    });
}

function transformUpstreams(req) {
    let weight;
    let down;
    let promiseChain = Promise.resolve(); // Initial chain

    try {
        for (let key in preloadedUpstreams) {
            let upstream = preloadedUpstreams[key];
            weight = upstream.weight;
            down = upstream.down;

            if (!down) {
                down = false;
            }
            if (!weight) {
                weight = 1;
            }

            // Append each promise to the chain
            promiseChain = promiseChain.then(function() {
                return resolveDomain(upstream.server).then(function(dnsResult) {
                    if (dnsResult && dnsResult.Answer && dnsResult.Answer.length > 0) {
                        let resolvedIPs = [];
                        dnsResult.Answer.forEach(function(answer) {
                            if (answer.type === 1 || answer.type === 28) {  // 1 = A record (IPv4), 28 = AAAA record (IPv6)
                                resolvedIPs.push(answer.data);
                            }
                        });

                        // Log the resolved IPs
                        ngx.log(ngx.INFO, 'Resolved IPs for ' + upstream.server + ': ' + resolvedIPs.join(', '));

                        // For each resolved IP, call proxy.set for each key in preloadedUpstreams
                        resolvedIPs.forEach(function(resolvedIP) {
                            // Set proxy for each resolved IP
                            proxy.set(key + '-' + resolvedIP, JSON.stringify({
                                "id": key,
                                "server": resolvedIP,  // Use the resolved IP
                                "down": down,
                                "weight": weight,
                                "host": upstream.server  // Original hostname for reference
                            }));

                            // Log the result (Optional)
                            ngx.log(ngx.INFO, 'Set proxy for IP: ' + resolvedIP + ' with key: ' + key);
                        });
                    } else {
                        ngx.log(ngx.ERR, 'No valid A or AAAA records for ' + upstream.server);
                    }
                });
            });
        }

        // After all promises are done, do this:
        promiseChain.then(function() {
            const ingress_name = req.variables['ingress_service'];
            count.set(ingress_name, 1);
            ngx.log(ngx.INFO, "Completed processing of all upstreams.");
        }).catch(function(error) {
            ngx.log(ngx.ERR, "Failed to process one or more upstreams: " + error.message);
            responseHandling(req, 500, 'Failed to process Upstreams');
        });

    } catch (e) {
        ngx.log(ngx.ERR, "Failed to read Upstreams or resolve domain: " + e.message);
        responseHandling(req, 500, 'Failed to process Upstreams');
    }
}


    
export default {
    getUpstream,
    handleUpstreamAPI
};