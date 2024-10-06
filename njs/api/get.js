// Import required modules
import querystring from 'querystring'

var count = ngx.shared.count; // Shared dictionary for counting requests and other counters

// Function to parse and validate query parameters with manual defaults
function parseQueryParams(req, defaults) {
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
function handleMultipleUpstreams(req, upstreamName) {
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
    var queryParams = parseQueryParams(req);

    var total_count = output.length; // Total number of upstreams
    var total_pages = Math.ceil(total_count / queryParams.per_page) || 1;
    var currentPage = Math.min(queryParams.page, total_pages);

    var start = (currentPage - 1) * queryParams.per_page;
    var end = start + queryParams.per_page;

    // Paginate the output based on the query parameters
    var paginatedOutput = output.slice(start, end);

    // Construct the response object
    var response = {
        success: true,
        errors: [],
        messages: [],
        result: paginatedOutput,
        result_info: {
            page: currentPage,
            per_page: queryParams.per_page,
            count: paginatedOutput.length,
            total_count: total_count,
            total_pages: total_pages
        }
    };

    // Set the Content-Type header and send the response
    req.headersOut['Content-Type'] = 'application/json';
    req.return(200, JSON.stringify(response));
}

function listCerts(req, domainName){
    let fields = ["tls_key", "tls_cert"];
    let certName = domainName;
    let kv = ngx.shared.kv;
    if (!kv.get(domainName + ":tls_key")){
        ingress.responseHandling(req, 404, `No certificate was found for: ${domainName}`);
        return;
    }
    let output = {}; // Initialize as an object to hold key-value pairs
    output["cert_name"] = certName;
    for (let i in fields){
        let key = fields[i];
        let value = kv.get(`${certName}:${key}`);
        value = encodeToBase64(value);
        output[key] = value; // Assign value to the corresponding key in the output object
    }
    req.headersOut['Content-Type'] = 'application/json';
    req.return(200, JSON.stringify(output));
}

function encodeToBase64(inputString) {
    // Create a Buffer from the input string
    var buffer = Buffer.from(inputString);
    
    // Convert the Buffer to a Base64-encoded string
    var base64String = buffer.toString('base64');
    
    return base64String;
}

// Function to handle request and response for a single upstream
function handleSingleUpstream(req, upstreamId, upstreamName) {
    // Check if the upstream exists
    if (!upstreamName.get(upstreamId)) {
        ingress.responseHandling(req, 404, 'Upstream not found!');
        return;
    }

    // Retrieve and parse the upstream data
    var parsedServer = JSON.parse(upstreamName.get(upstreamId));
    parsedServer.requests = count.get(parsedServer.endpoint) || 0;

    // Construct the response object
    var response = {
        success: true,
        errors: [],
        messages: [],
        result: parsedServer,
        result_info: null // No pagination info for a single item
    };

    // Set the Content-Type header and send the response
    req.headersOut['Content-Type'] = 'application/json';
    req.return(200, JSON.stringify(response));
}

export default {
    handleMultipleUpstreams,
    handleSingleUpstream,
    listCerts
}