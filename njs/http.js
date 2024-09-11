function getUpstream(req) {

    var host;
    // Try to use the server_name from Nginx configuration
    host = req.variables.host.toLowerCase();

    // If server_name is not found, fall back to the Host header
    if (!host) {
        host = req.headersIn['Host'].toLowerCase();
    }


    if (host == "mydomain1.com") {

        return "https://www.google.com"

    }

    if (host == "mydomain2.com") {

        return "https://www.amazon.com"

    }

    req.return(404, "Backend not found");

    req.finish();

    // Invalid return just so it wont complain

    return "@invalidstuff"

}


export default {getUpstream};

