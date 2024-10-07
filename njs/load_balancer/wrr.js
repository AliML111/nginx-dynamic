let count = ngx.shared.count;

// Function to get the upstream for the request
function get_upstream(req) {
    let upstreamName = req.variables['upstream_name'];
    upstreamName = ngx.shared[upstreamName];

    // Initialize upstreams for this handler if they haven't been loaded yet
    if (!count.get(upstreamName)) {
        handler.load_upstreams(req, upstreamName);
        ngx.log(ngx.INFO, "Read from fs");
    }

    // Get the list of upstreams from the shared dictionary
    let items = upstreamName.items();
    let numUpstreams = items.length;

    // Return error if no upstreams are available
    if (numUpstreams === 0) {
        invalid_backend(req, 503);
        return;
    }

    // Calculate total weight
    let totalWeight = count.get(upstreamName + '_total_weight');
    if (!totalWeight) {
        totalWeight = 0;
        for (let i = 0; i < numUpstreams; i++) {
            totalWeight += JSON.parse(items[i][1]).weight;
        }
        count.set(upstreamName + '_total_weight', totalWeight);
    }

    // Generate random number between 0 and total weight
    let randomWeight = Math.random() * totalWeight;
    let backend;
    let backendWeight= 0;
    let accumulatedWeight = 0;
    for (let i = 0; i < numUpstreams; i++) {
        let currentItem = JSON.parse(items[i][1]);
        accumulatedWeight += currentItem.weight;
        if (accumulatedWeight >= randomWeight) {
            backend = currentItem.endpoint;
            backendWeight = currentItem.weight;
            // Increment request count for the backend
            count.incr(currentItem.id, 1, 0);
            break;
        }
    }

    // Return the selected backend endpoint
    return backend;
}

// Function to handle invalid backend cases
function invalid_backend(req, code) {
    req.return(code, 'Invalid Backend');
    req.finish();
    return '@invalid_backend';
}

export default {
    get_upstream
}
