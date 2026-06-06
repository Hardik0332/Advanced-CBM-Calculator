$outputFile = "combined.txt"

# 1. Define what to KEEP (add or remove your specific coding languages here)
$allowedExtensions = @('.cs', '.js', '.ts', '.py', '.json', '.html', '.css', '.ps1', '.txt', '.md')

$files = Get-ChildItem -Recurse -File | Where-Object {
    $path = $_.FullName
    
    # 2. Define what to THROW AWAY (Filters out common massive directories)
    $isInJunkFolder = $path -match '\\node_modules\\|\\.git\\|\\bin\\|\\obj\\|\\venv\\|\\dist\\|\\build\\'
    
    # 3. Check if the extension is in our allowed list
    $isValidExtension = $allowedExtensions -contains $_.Extension
    
    # 4. Final condition: Not junk, valid extension, and not the output file itself
    (-not $isInJunkFolder) -and $isValidExtension -and ($_.Name -ne $outputFile)
}

$stream = [System.IO.StreamWriter]::new("$PWD\$outputFile")

foreach ($f in $files) {
    $stream.WriteLine("// ===== $($f.FullName) =====")
    $stream.WriteLine([System.IO.File]::ReadAllText($f.FullName))
    $stream.WriteLine("")
}
$stream.Close()

Write-Host "Done! File saved as $outputFile"