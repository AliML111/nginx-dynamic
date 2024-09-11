var keys = ["rkatz-nginx2-80-safety","false","rkatz-nginx2-80-2","172.29.43.89","rkatz-nginx2-80-0","192.168.0.130","rkatz-nginx2-80-1","8.8.148.85"];  // Retrieve all keys
var jsonObject={};
// Filter the keys that contain the includeSubstring but not the excludeSubstring
for (var i = 1; i < keys.length / 2; i++) {
    // if (keys[i].includes(includeSubstring) && !keys[i].includes(excludeSubstring) && proxy.get(keys[i]) != "") {
    // responseBody += keys[2*i] + ": " + keys[2*i+1] + "\n";
    jsonObject[keys[i]] = keys[i-1];
}
print 