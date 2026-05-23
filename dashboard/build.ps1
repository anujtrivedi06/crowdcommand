$ErrorActionPreference = "Stop"

react-scripts build
New-Item -ItemType Directory -Force -Path build\fan | Out-Null
Copy-Item -Recurse -Force ..\fan-pwa\build\* build\fan\
