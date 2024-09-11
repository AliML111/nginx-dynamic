import fs from 'fs';

// Initialize shared dictionary for upstreams
const upstreamsDict = ngx.shared.upstreams;

// Reads upstreams from the JSON file on disk and populates the shared dictionary
function readUpstreams() {
    try {
        const data = fs.readFileSync('/etc/nginx/upstreams/test', 'utf8');
        const parsedData = JSON.parse(data);

        // Assuming parsedData contains the `upstreams` array
        const upstreams = parsedData.upstreams;

        // Loop through the upstreams array and set them individually in the shared dictionary
        for (let i = 0; i < upstreams.length; i++) {
            const upstream = upstreams[i];
            upstreamsDict.set(upstream.name, JSON.stringify(upstream));
        }

        ngx.log(ngx.INFO, 'Upstreams loaded from file');
    } catch (e) {
        ngx.log(ngx.ERR, `Error reading upstreams file: ${e.message}`);
    }
}

// Writes upstreams from the shared dictionary to the JSON file on disk
function writeUpstreams() {
    try {
        // List all upstreams and convert to JSON
        const upstreams = listAllUpstreams();

        // Check if upstreams is an array and serialize it properly
        if (Array.isArray(upstreams)) {
            const data = JSON.stringify({ upstreams }, null, 4);

            // Write the serialized data to the file
            fs.writeFileSync('/etc/nginx/upstreams/test', data, 'utf-8');
            ngx.log(ngx.INFO, 'Upstreams saved to file');
        } else {
            ngx.log(ngx.ERR, 'Upstreams data is not an array');
        }
    } catch (e) {
        ngx.log(ngx.ERR, `Error writing upstreams file: ${e.message}`);
    }
}

// Handle API requests to manage upstreams
async function handleUpstreamAPI(r) {
    if (r.method === 'GET') {
        const key = getKeyFromURI(r.uri);

        if (key) {
            const data = upstreamsDict.get(key);
            if (data) {
                r.return(200, data);
            } else {
                r.return(404, 'Upstream not found');
            }
        } else {
            const upstreams = listAllUpstreams();
            r.return(200, JSON.stringify(upstreams));
        }
    } else if (r.method === 'POST') {
        const requestBody = r.requestText;

        if (requestBody) {
            try {
                // Parse the request body as JSON
                const newUpstream = JSON.parse(requestBody);
                
                // Read existing upstreams from shared dictionary
                const existingData = upstreamsDict.get('upstreams');
                let upstreams = existingData ? JSON.parse(existingData) : [];

                // Add or update the new upstream
                const index = upstreams.findIndex(u => u.name === newUpstream.name);
                if (index !== -1) {
                    // Update existing upstream
                    upstreams[index] = newUpstream;
                } else {
                    // Add new upstream
                    upstreams.push(newUpstream);
                }

                // Save updated upstreams back to the shared dictionary
                upstreamsDict.set('upstreams', JSON.stringify(upstreams));
                await writeUpstreams(); // Save to file

                r.return(201, 'Created or Updated');
            } catch (e) {
                ngx.log(ngx.ERR, 'Error processing POST request: ' + e.message);
                r.return(400, 'Invalid JSON provided');
            }
        } else {
            r.return(400, 'No data provided');
        }
    } else if (r.method === 'DELETE') {
        const key = getKeyFromURI(r.uri);
        if (key) {
            upstreamsDict.delete(key);
            writeUpstreams();  // Save to file after deletion
            r.return(204, 'Deleted');
        } else {
            r.return(400, 'Invalid key');
        }
    } else {
        r.return(405, 'Method Not Allowed');
    }
}

// Retrieve upstreams from shared dict and choose dynamically
function get_dynamic_upstream(r) {
    const keys = upstreamsDict.keys();
    if (keys.length === 0) {
        return 'http://default-backend';
    }

    const validUpstreams = [];
    const backupUpstreams = [];

    // Loop through keys and filter upstreams
    for (let i = 0; i < keys.length; i++) {
        const upstream = JSON.parse(upstreamsDict.get(keys[i]));

        if (!upstream.down) {
            if (upstream.backup) {
                backupUpstreams.push(upstream);
            } else {
                validUpstreams.push(upstream);
            }
        }
    }

    if (validUpstreams.length > 0) {
        // Round-robin with weight logic
        let totalWeight = 0;
        for (let i = 0; i < validUpstreams.length; i++) {
            totalWeight += validUpstreams[i].weight;
        }

        const rand = Math.random() * totalWeight;
        let weightSum = 0;

        for (let i = 0; i < validUpstreams.length; i++) {
            weightSum += validUpstreams[i].weight;
            if (rand <= weightSum) {
                r.log('Selected upstream: ' + validUpstreams[i].address);
                return validUpstreams[i].address;
            }
        }
    }

    if (backupUpstreams.length > 0) {
        r.log('No primary upstreams available, using backup.');
        return backupUpstreams[0].address;
    }

    return 'http://default-backend';
}

// Helper function to extract key from URI
function getKeyFromURI(uri) {
    const match = uri.match(/\/upstreams\/([^\/]+)/);
    return match ? match[1] : null;
}

// Parse request body into key and value without object destructuring
function parseRequestBody(body) {
    const lines = body.split('\n');
    return {
        key: lines[0].trim(),
        value: lines[1].trim()
    };
}

function listAllUpstreams() {
    const upstreams = [];
    const keys = upstreamsDict.keys();

    for (let i = 0; i < keys.length; i++) {
        const upstreamData = upstreamsDict.get(keys[i]);
        try {
            const parsedData = JSON.parse(upstreamData);
            upstreams.push({
                key: keys[i],
                data: parsedData
            });
        } catch (e) {
            ngx.log(ngx.ERR, `Error parsing upstream data: ${e.message}`);
        }
    }

    return upstreams;
}

// Load upstreams on startup
readUpstreams();  // Load from file on NGINX start

export default {
    handleUpstreamAPI,
    get_dynamic_upstream
};
