// Import required modules
import querystring from 'querystring'

var count = ngx.shared.count; // Shared dictionary for counting requests and other counters

// Function to parse and validate query parameters with manual defaults
function parse_query_params(req, defaults) {
    // Provide default values if not supplied
    defaults = defaults || { page: 1, per_page: 10, max_per_page: 100 };

    // Get the query string from the request
    var queryString = req.variables.query_string || '';
    var queryParams = querystring.parse(queryString);

    // Parse 'page' and ensure it's a valid number; default to 1
    var page = parseInt(queryParams.page);
    if (isNaN(page) || page < 1) {
        page = defaults.page;
    }

    // Parse 'per_page' and ensure it's within valid limits
    var per_page = parseInt(queryParams.per_page);
    if (isNaN(per_page) || per_page < 1) {
        per_page = defaults.per_page;
    } else if (per_page > defaults.max_per_page) {
        per_page = defaults.max_per_page;
    }

    return { page: page, per_page: per_page };
}

// Function to handle request and response for multiple upstreams
function list_multiple_upstreams(req, upstreamName) {
    var output = [];
    var items = upstreamName.items(4096);

    // Collect all upstreams and their request counts
    for (var i in items) {
        var parsedServer = JSON.parse(items[i][1]);
        parsedServer.requests = count.get(parsedServer.endpoint) || 0;
        output.push(parsedServer);
    }

    // Sort the upstreams by ID in ascending order
    output.sort(function (a, b) {
        return a.id - b.id;
    });

    // Parse query parameters for pagination
    var queryParams = parse_query_params(req);

    var total_count = output.length; // Total number of upstreams
    var total_pages = Math.ceil(total_count / queryParams.per_page) || 1;
    var currentPage = Math.min(queryParams.page, total_pages);

    var start = (currentPage - 1) * queryParams.per_page;
    var end = start + queryParams.per_page;

    // Paginate the output based on the query parameters
    var paginatedOutput = output.slice(start, end);

    
        var result_info = {
            page: currentPage,
            per_page: queryParams.per_page,
            count: paginatedOutput.length,
            total_count: total_count,
            total_pages: total_pages
        };

    handler.response_handler(req, 200, "", paginatedOutput, result_info);
}

// Function to handle request and response for a single upstream
function list_single_upstream(req, upstreamId, upstreamName) {
    // Check if the upstream exists
    if (!upstreamName.get(upstreamId)) {
        handler.response_handler(req, 404, 'Upstream not found!');
        return;
    }

    // Retrieve and parse the upstream data
    var parsedServer = JSON.parse(upstreamName.get(upstreamId));
    parsedServer.requests = count.get(parsedServer.endpoint) || 0;

    handler.response_handler(req, 200, "", parsedServer, null);
}

export default {
    list_multiple_upstreams,
    list_single_upstream
}