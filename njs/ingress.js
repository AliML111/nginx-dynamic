const proxy = ngx.shared.proxy;
var fs = require('fs');
var id = 0;
function getUpstream(req) {
    readConfig(req);
    countKeys(req);
    const ingress_name = req.variables['ingress_service'];

    try {
        var randomBackend = Math.floor(Math.random() * id);
        var key = ingress_name + "-" + randomBackend;
        return proxy.get(key).replace(/^\s+|\s+$/g, '');
    }   catch (e) {
        ngx.log(ngx.ERR, "Failed at choosing backend: " + e.message);
        req.return(500, "Failed at choosing backend");
    }  
}
        
        
        

        // The final replace is to remove some dirty line break
        

    // } catch (e) {
    //     req.error(e);
    //     return invalidBackend(req, 502);
    // }

    // return invalidBackend(req, 503);  



function invalidBackend(req, code) {
    req.return(code, "Invalid Backend");
    req.finish();
    return "@invalidbackend";
}
function listUpstreams (req) {
        try {
             // Return the sorted keys as a response
             req.return(200, JSON.stringify(proxy.items()));

        } catch (e) {
            ngx.log(ngx.ERR, "Failed to list Upstreams: " + e.message);
            req.return(500, "Failed to list Upstreams");
        }
}
function addUpstreams (req) {
    const requestBody = req.requestBuffer;
        if (requestBody) {
            try {
                // Parse the request body as JSON
                const payloadData = JSON.parse(requestBody);
                const key = payloadData.id;
                const value = payloadData.server_name;
                // const validation = validateAndResolveDomain(value);
                if (!key || !value) {
                    req.return(400, 'id or server_name field is empty');
                }
                if ( proxy.get(key) == undefined ) {
                    proxy.set(key, value);

                    if ( proxy.get(key) != undefined ) {
                    
                        req.return(204, 'Created');
                    } else {
                        ngx.log(ngx.ERR, 'Failed to add upstream with key: ' + key);
                        req.return(500, 'Key not set!');
                    }
                } else {
                    req.return(400, 'This id already exists');
                }
                writeConfig(req);  // Save to file after deletion
                
            } catch (e) {
                ngx.log(ngx.ERR, 'Error processing POST request: ' + e.message);
                req.return(400, 'Invalid JSON provided');
            }
        } else {
            req.return(400, 'Data not provided');
        }
}

function deleteUpstreams (req) {
    const requestBody = req.requestBuffer;

        if (requestBody) {
            try {
                // Parse the request body as JSON
                const upstreamId = JSON.parse(requestBody);
                const key = upstreamId.id;
                if ( proxy.get(key) != undefined ) {
                    proxy.delete(key);
                    if ( proxy.get(key) == undefined ) {
                    
                        req.return(204, 'Deleted');
                    } else {
                        ngx.log(ngx.ERR, 'Failed to delete upstream with key: ' + key );
                        req.return(500, 'Failed to delete upstream');
                    }
                } else {
                    req.return(400, 'Such an id does not exist!' + proxy.items());
                }
                writeConfig(req);  // Save to file after deletion
                
            } catch (e) {
                ngx.log(ngx.ERR, 'Error processing DELETE request: ' + e.message);
                req.return(400, 'Invalid JSON provided');
            }
        } else {
            req.return(400, 'Invalid key');
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

async function handleUpstreamAPI(req) {
    readConfig(req);
    if (req.method === 'GET') {
        listUpstreams (req);
    } else if (req.method === 'POST') {
        addUpstreams(req);
    } else if (req.method === 'DELETE') {
        deleteUpstreams(req);
    }   else if (req.method === 'PURGE') {
        purgeSharedDict(req);
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
                // Set the endpoint in the shared dictionary
                let key = ingress_name + "-" + i;
                proxy.set(key, endpoint);
            }
            // }
        }
        ngx.log(ngx.INFO, 'Upstreams loaded from file');
    } catch (e) {
        ngx.log(ngx.ERR, `Error reading upstreams file: ${e.message}`);
    }
}

async function writeConfig(req) {
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
                // if ()
                await fs.appendFile(upstreamfile, items[i][1] + "\n", 'utf8', (err) => {
                    if (err) {
                        ngx.log(ngx.ERR, 'Error writing file: ' + err.message);
                        req.return(500, 'Error writing file');
                    } else {
                        req.return(200, 'Data successfully written');
                    }
                });
                
            }
            // else if ( items[i][0] != key && i == --id ) {
            //     upstreamList += items[i][1];
            // }
        }
        // fs.writeFileSync(upstreamfile, upstreamList, 'utf8');
        // req.return(200, "File successfully overwritten.");
        // fs.appendFileSync(filePath, data, 'utf8');
        req.return(200, "Data successfully written to the file.");
    } catch (e) {
        ngx.log(ngx.ERR, "Failed to write to file: " + e.message);
        req.return(500, "Failed to write to file");
    }
}

function countKeys(req) {
    
    try {
        id = proxy.size();
        // id = (id - 1);

    } catch (e) {
        req.return(500, "Failed to count Upstreams: " + e.message);
    }
    
    
}


    

export default {
    getUpstream,
    handleUpstreamAPI
};