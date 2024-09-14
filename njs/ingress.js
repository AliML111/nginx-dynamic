const proxy = ngx.shared.proxy;
let fs = require('fs');
let id = 0;
const count = ngx.shared.count;
let roundRobinIndex;
let upstreamId;
function getUpstream(req) {
    const ingress_name = req.variables['ingress_service'];
    let check = count.get(ingress_name);
    if (check == undefined){
        readConfig(req);
        count.set(ingress_name, 1);
    }
    countKeys(req);   // Get the number of upstreams
    let items = proxy.items();
    roundRobinIndex = count.get('index') || 0;

    ngx.log(ngx.ERR, "backend: " + roundRobinIndex);


    try {
        // Round-robin logic: pick the next backend in a circular manner
        if (id > 0) {
            if (roundRobinIndex >= items.length) {
                count.set('index', 0);
                roundRobinIndex = count.get('index');
                ngx.log(ngx.ERR, "reset: " + roundRobinIndex);

            }

            let backendIndex = items[roundRobinIndex][0];
            // ngx.log(ngx.ERR, "debug: " + backendIndex);
            var backend = items[backendIndex][1].replace(/^\s+|\s+$/g, '');
            ngx.log(ngx.ERR, "before: " + roundRobinIndex + ', backend: ' + backend);
            
            // Move to the next backend for the next request
            count.incr('index',1);
            ngx.log(ngx.ERR, "after: " + count.get('index'));

            return backend;
        } else {
            invalidBackend(req, 503);
            throw new Error("No available upstreams to choose from");
        }
    } catch (e) {
        ngx.log(ngx.ERR, "Failed at choosing backend: " + e.message);
        req.return(500, "Failed at choosing backend");
    }  
}

function invalidBackend(req, code) {
    req.return(code, "Invalid Backend");
    req.finish();
    return "@invalidbackend";
}
function listUpstreams (req) {
    handleRequest(req);
    let output;
        try {
            if (upstreamId){
                output = {
                  server_name: proxy.get(upstreamId),
                }
                req.return(200, JSON.stringify(output));
            } else {
                // Return the sorted keys as a response
                req.return(200, JSON.stringify(proxy.items()));
            } 

        } catch (e) {
            ngx.log(ngx.ERR, "Failed to list Upstreams: " + e.message);
            output = {
                error: "Failed to list Upstreams"
              }
            req.return(500, JSON.stringify(output));
        }
}
function addUpstreams (req) {
    const requestBody = req.requestBuffer;
    countKeys(req);
    let output;
        if (requestBody) {
            try {
                // Parse the request body as JSON
                const payloadData = JSON.parse(requestBody);
                const key = id++;
                const value = payloadData.server_name;
                // const validation = validateAndResolveDomain(value);
                if (!value) {
                    output = {
                        error: 'server_name field is empty'
                    }
                    req.return(400, JSON.stringify(output));
                }
                let items = proxy.items();
                items = items.some(row => row.includes(value));
                if ( items == false ) {
                    proxy.set(key, value);

                    if ( proxy.get(key) != undefined ) {
                        output = {
                            result: 'Created'
                        }
                        req.return(201, JSON.stringify(output));
                    } else {
                        ngx.log(ngx.ERR, 'Failed to add upstream with key: ' + key);
                        output = {
                            error: 'Key not set!'
                        }
                        req.return(400, JSON.stringify(output));
                    }
                } else {
                    output = {
                        error: 'This server_name already exists'
                    }
                    req.return(400, JSON.stringify(output));
                }
                // writeConfig(req);  // Save to file after deletion
                
            } catch (e) {
                ngx.log(ngx.ERR, 'Error processing POST request: ' + e.message);
                output = {
                    error: 'Could not add upstream'
                }
                req.return(500, JSON.stringify(output));
            }
        } else {
            output = {
                error: 'Data not provided'
            }
            req.return(400, JSON.stringify(output));
        }
}

function deleteUpstreams (req) {
    handleRequest(req);
    const requestBody = req.requestBuffer;
    let givenId;
    let output;
        if (requestBody || upstreamId) {
            try {
                if (upstreamId){
                    givenId = upstreamId;
                } else {
                    // Parse the request body as JSON
                    givenId = JSON.parse(requestBody);
                    givenId= givenId.id;
                    
                }
                const key = givenId;
                if ( proxy.get(key) != undefined ) {
                    proxy.delete(key);
                    if ( proxy.get(key) == undefined ) {
                        output = {
                            result: 'Deleted'
                        }
                        req.return(204, JSON.stringify(output));
                    } else {
                        ngx.log(ngx.ERR, 'Failed to delete upstream with key: ' + key );
                        output = {
                            error: 'Failed to delete upstream'
                        }
                        req.return(500, JSON.stringify(output));
                    }
                } else {
                    output = {
                        error: 'Such an id does not exist!'
                    }
                    req.return(404, JSON.stringify(output));
                }
                // writeConfig(req);  // Save to file after deletion
                
            } catch (e) {
                ngx.log(ngx.ERR, 'Error processing DELETE request: ' + e.message);
                output = {
                    error: 'Invalid JSON provided'
                }
                req.return(400, JSON.stringify(output));
            }
        } else {
            output = {
                error: 'Invalid JSON'
            }
            req.return(400, JSON.stringify(output));
        }
}

function purgeSharedDict(req) {
    try {
        proxy.clear();
        readConfig(req);
        req.return(204, 'Purged');

    } catch (e) {
        ngx.log(ngx.ERR, 'Error processing PURGE request: ' + e.message);
        req.return(500, 'There was a problem in purging...');
    }
}

function editUpstreams(req) {
    handleRequest(req);
    const requestBody = req.requestBuffer;
    let givenId;
        if (requestBody || upstreamId) {
            try {
                // Parse the request body as JSON
                const payloadData = JSON.parse(requestBody);
                const value = payloadData.server_name;
                if (upstreamId){
                    givenId = upstreamId;
                } else {
                    givenId = payloadData.id;
                }
                const key = givenId;
                // const validation = validateAndResolveDomain(value);
                if (!key || !value) {
                    req.return(400, 'id or server_name field is empty');
                }
                let items = proxy.items();
                items = items.some(row => row.includes(value));
                if ( proxy.get(key) != undefined && items == false ) {
                    proxy.set(key, value);

                    if ( proxy.get(key) == value ) {
                    
                        req.return(204, 'Edited');
                    } else {
                        ngx.log(ngx.ERR, 'Failed to edit upstream with key: ' + key);
                        req.return(400, 'Upstreams not edited!');
                    }
                } else {
                    req.return(400, 'This id does not exist or server_name already exists');
                }
                // writeConfig(req);  // Save to file after deletion
                
            } catch (e) {
                ngx.log(ngx.ERR, 'Error processing POST request: ' + e.message);
                req.return(500, 'Could not add upstream');
            }
        } else {
            req.return(400, 'Data not provided');
        }
}

function handleRequest(req) {
    // Get the complete URI
    const uri = req.uri;

    // Use regex to extract the ID from any URL that ends with /<id>/
    const match = uri.match(/\/(\d+)\/$/);

    // If a match is found, extract the numeric ID
    if (match && match[1]) {
        upstreamId = match[1];  // This will be the numeric ID
        ngx.log(ngx.INFO, 'Extracted Upstream ID: ' + upstreamId);

        // Now you can handle the upstreamId (fetch from shared dictionary, etc.)
        // req.return(200, 'Upstream ID: ' + upstreamId);
    } else {
        // If no ID is found, return an error
        req.return(400, 'Invalid URL format. No numeric ID found.');
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
    } else if (req.method === 'PUT') {
        editUpstreams(req);
    } else if (req.method === 'OPTIONS') {
        handleRequest(req);
    }
    else {
        req.return(405, 'Method Not Allowed');
    }
}

function readConfig (req) {
    const ingress_name = req.variables['ingress_service'];
    const upstreamfile = req.variables['upstreamFilePath'] + ingress_name; 
    const upstream = fs.readFileSync(upstreamfile, 'utf8');
    let endpointArr = upstream.split("\n");
 

    try {

        // Set elements with IDs, checking for duplicates
        for (let i = 0; i < endpointArr.length; i++) {
            let endpoint = endpointArr[i].replace(/^\s+|\s+$/g, '');
            if (endpoint.length != 0) {

                let key = i;
                let items = proxy.items();
                items = items.some(row => row.includes(endpoint));
                if ( items == true ) {
                    endpointArr.splice(i, 1);
                    endpoint = endpointArr[i].replace(/^\s+|\s+$/g, '');

                }
                proxy.set(key, endpoint);
            }

        }

        count.set(ingress_name, 1);
        ngx.log(ngx.INFO, 'Upstreams loaded from file');
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
        req.return(500, "Failed to write to file");
    }
}

function countKeys(req) {
    
    try {
        id = proxy.size();

    } catch (e) {
        req.return(500, "Failed to count Upstreams: " + e.message);
    }
    
    
}


    

export default {
    getUpstream,
    handleUpstreamAPI
};