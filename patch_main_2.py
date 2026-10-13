with open("backend/vardhan_receipt/src/main.rs", "r") as f:
    lines = f.readlines()

out = []
for line in lines:
    if "Commands::Serve { port } => {" in line:
        continue
    if "gateway::start_server(*port).await;" in line:
        continue
    if "Commands::Verify { receipt_id: _ } => {" in line:
        out.append("        Commands::Serve { port } => {\n")
        out.append("            gateway::start_server(*port).await;\n")
        out.append("        },\n")
    out.append(line)

with open("backend/vardhan_receipt/src/main.rs", "w") as f:
    f.writelines(out)
