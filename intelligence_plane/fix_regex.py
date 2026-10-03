with open("/Users/vishnuvardhanburri/Vardhan Q Core /intelligence_plane/src/server/ApiOperationParser.ts", "r") as f:
    content = f.read()

# Replace the problematic regex literal with RegExp constructor
content = content.replace("const curlRegex = /curl\s+[^]+?(?=\n\n|$)/gi;", "const curlRegex = new RegExp('curl\\\\s+[\\\\s\\\\S]+?(?=\\\\n\\\\n|$)', 'gi');")

with open("/Users/vishnuvardhanburri/Vardhan Q Core /intelligence_plane/src/server/ApiOperationParser.ts", "w") as f:
    f.write(content)
