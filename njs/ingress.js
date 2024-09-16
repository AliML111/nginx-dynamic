const proxy = ngx.shared.proxy;
let fs = require('fs');
let id = 0;
const count = ngx.shared.count;
// let roundRobinIndex;
let upstreamId;
function getUpstream(req) {
    const ingress_name = req.variables['ingress_service'];

    // Initialize roundRobinIndex and weight counter
    let roundRobinIndex = count.get('index') || 0;
    let weightCounter = count.get('weight') || 0;

    // Initialize upstreams for this ingress if they haven't been loaded yet
    if (!count.get(ingress_name)) {
        readConfig(req);
        count.set(ingress_name, 1);
    }

    // Get the list of upstreams from the shared dictionary
    const items = proxy.items();
    const numUpstreams = items.length;

    // Return error if no upstreams available
    if (numUpstreams === 0) {
        invalidBackend(req, 503);
        return;
    }

    // Get the backend for the current round-robin index
    let currentItem = JSON.parse(items[roundRobinIndex][1]);
    let backend = currentItem.endpoint.trim();
    let backendWeight = currentItem.weight;

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
        ngx.log(ngx.ERR, 'Added trailing slash: ' + uri);
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

function responseHandling (req, resCode, resMessage, extra){
    let output;
    if (extra){
        output = {
            code: resCode,
            message: resMessage,
            text: extra
        }
    } else {
        output = {
            code: resCode,
            message: resMessage
        }
    }
        
    // } else {
    //     output = resMessage;
    
    // }
    req.return(resCode, JSON.stringify(output));
    req.finish();
}

function listUpstreams (req) {
    handleRequest(req);
        try {
            if (upstreamId){
                if (!proxy.get(upstreamId)){
                    responseHandling(req, 404, 'Upstream not found!');
                    return;
                }
                let output = {
                    endpoint: JSON.parse(proxy.get(upstreamId)).endpoint,
                    weight: JSON.parse(proxy.get(upstreamId)).weight
                }
                responseHandling(req, 200, output);

            } else {
                // Return the sorted keys as a response
                countKeys(req);
                let output = [];
                let items = proxy.items();
                for (let i=0;i < id; i++){
                    let item = {
                        id: items[i][0],
                        endpoint:  JSON.parse(items[i][1]).endpoint,
                        weight:  JSON.parse(items[i][1]).weight
                    };
                    output.push(item);
                }
                req.return(200, JSON.stringify(output, null, 2));
                // req.finish();

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
                const serverId = payloadData.id;
                let key;
                if (serverId){
                    key = serverId;
                    if (proxy.get(key)){
                        responseHandling(req, 409, 'This id already exists');
                        return;
                    }
                } else {
                    key = id++;
                }

                if ( proxy.get(key) != undefined ) {
                    responseHandling(req, 409, 'This id already exists!');
                    return;
                }

                const endpoint = payloadData.endpoint.trim();
                let weight = payloadData.weight;
                // const validation = validateAndResolveDomain(endpoint);
                if (!endpoint) {
                    responseHandling(req, 400, 'endpoint field is empty');
                    return;
                }
                if (!weight) {
                    weight = 1;
                }

                let items = proxy.items();
                items = items.some(row => {
                    let storedValue = JSON.parse(row[1]);  // Parse stored JSON string
                    return storedValue.endpoint === endpoint;  // Compare endpoints
                });

                if ( items != false ) {
                    responseHandling(req, 409, 'This endpoint already exists');
                    return;
                }
                proxy.set(key, JSON.stringify({ "endpoint": endpoint, "weight": weight }));
                
                items = {
                    id: key,
                    endpoint:  JSON.parse(proxy.get(key)).endpoint,
                    weight:  JSON.parse(proxy.get(key)).weight 
                }
                responseHandling(req, 201, 'Created' , items);
                        

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
    handleRequest(req);
    const requestBody = req.requestBuffer;
    let key;
        if (requestBody || upstreamId) {
            try {
                if (upstreamId){
                    key = upstreamId;
                } else {
                    // Parse the request body as JSON
                    key = JSON.parse(requestBody);
                    key= key.id;
                    
                }

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
        readConfig(req);
        responseHandling(req, 204, 'Purged');

    } catch (e) {
        ngx.log(ngx.ERR, 'Error processing PURGE request: ' + e.message);
        responseHandling(req, 500, 'There was a problem in purging');
    }
}

function editUpstreams(req) {
    handleRequest(req);
    const requestBody = req.requestBuffer;
    let key;
    
    if (requestBody || upstreamId) {
        try {
            // Parse the request body as JSON
            const payloadData = JSON.parse(requestBody);
            const endpoint = payloadData.endpoint;
            if (upstreamId) {
                key = upstreamId;
            } else {
                key = payloadData.id;
            }

            if (!key || !endpoint) {
                responseHandling(req, 400, 'id or endpoint field is empty');
                return;
            }

            let weight = payloadData.weight;

            if (!weight) {
                weight = 1;
            }

            let items = proxy.items();
            
            // Check if the endpoint already exists
            items = items.some(row => {
                let storedValue = JSON.parse(row[1]);  // Parse stored JSON string
                return storedValue.endpoint === endpoint;  // Compare endpoints
            });

            if (items) {
                responseHandling(req, 409, 'This endpoint already exists');
                return;
            }

            if (proxy.get(key) == undefined) {
                responseHandling(req, 404, 'This id does not exist');
                return;
            }

                proxy.set(key, JSON.stringify({ "endpoint": endpoint.trim(), "weight": weight }));

                if (proxy.get(key) == JSON.stringify({ "endpoint": endpoint, "weight": weight })) {
                    responseHandling(req, 204, 'Edited');
                } else {
                    ngx.log(ngx.ERR, 'Failed to edit upstream with key: ' + key);
                    responseHandling(req, 500, 'Upstreams not edited!');
                    return;
                }

        } catch (e) {
            ngx.log(ngx.ERR, 'Error processing POST request: ' + e.message);
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
        readConfig(req);
    }
    if (req.method === 'GET') {
        listUpstreams (req);
    } else if (req.method === 'POST') {
        addUpstreams(req);
    } else if (req.method === 'DELETE') {
        deleteUpstreams(req);
    } else if (req.method === 'PURGE') {
        purgeSharedDict(req);
    } else if (req.method === 'PATCH') {
        editUpstreams(req);
    }
    else {
        responseHandling(req, 405, 'Method Not Allowed');
    }
}

function readConfig(req) {
    const ingress_name = req.variables['ingress_service'];
    const upstreamfile = req.variables['upstreamFilePath'] + ingress_name; 
    const upstream = fs.readFileSync(upstreamfile, 'utf8');
    let endpointArr = upstream.split("\n");

    try {
        for (let i = 0; i < endpointArr.length; i++) {
            let endpointLine = endpointArr[i].trim();
            
            if (endpointLine.length !== 0) {
                // Check if the line contains 'weight=' and split accordingly
                let index = endpointLine.indexOf(' weight=');
                let endpoint;
                let weight;

                if (index !== -1) {
                    endpoint = endpointLine.substring(0, index).trim();
                    weight = parseInt(endpointLine.substring(index + 8).trim());  // Extract weight
                } else {
                    endpoint = endpointLine;  // No weight found, set default
                    weight = 1;
                }

                // Store the backend and weight in the shared dictionary
                let key = i;
                proxy.set(key, JSON.stringify({ "endpoint": endpoint, "weight": weight }));
            }
        }

        count.set(ingress_name, 1);
        ngx.log(ngx.INFO, 'Upstreams with weights loaded from file');
    } catch (e) {
        ngx.log(ngx.ERR, `Error reading upstreams file: ${e.message}`);
    }
}


function writeConfig(req) {
    const ingress_name = req.variables['ingress_service'];
    const upstreamfile = req.variables['upstreamFilePath'] + ingress_name;
    countKeys(req);
    // Overwrite the file with the new content
    try {
        var items = proxy.items();
        var key = req.variables.ingress_service + "-" + "safety";
        fs.openSync(upstreamfile, 'w');
        for (var i = 0; i < id; i++) {
            if ( items[i][0] != key) {

               fs.appendFileSync(upstreamfile, items[i][1] + "\n", 'utf8');
                
            }

        }
        // fs.writeFileSync(upstreamfile, upstreamList, 'utf8');
        // req.return(200, "File successfully overwritten.");
        // fs.appendFileSync(filePath, data, 'utf8');
        // if (err) {
        //     ngx.log(ngx.ERR, 'Error writing file: ' + err.message);
        //     req.return(500, 'Error writing file');
        // } else {
            req.return(200, 'Data successfully written');
        // }
    } catch (e) {
        ngx.log(ngx.ERR, "Failed to write to file: " + e.message);
        responseHandling(req, 500, 'Failed to write to file');
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


    

export default {
    getUpstream,
    handleUpstreamAPI
};