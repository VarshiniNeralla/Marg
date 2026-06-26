import os

def process_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Text and backgrounds
    content = content.replace("backgroundColor: '#000'", "backgroundColor: '#ffffff'")
    content = content.replace("backgroundColor: '#050505'", "backgroundColor: '#fafafa'")
    content = content.replace("backgroundColor: '#09090b'", "backgroundColor: '#ffffff'")
    content = content.replace("background: '#000'", "background: '#ffffff'")
    content = content.replace("background: '#09090b'", "background: '#ffffff'")
    content = content.replace("backgroundColor: '#18181b'", "backgroundColor: '#f4f4f5'")
    content = content.replace("color: '#fff'", "color: '#18181b'")
    content = content.replace("color: '#ffffff'", "color: '#18181b'")
    content = content.replace("color: '#e4e4e7'", "color: '#3f3f46'")
    content = content.replace("color: '#a1a1aa'", "color: '#52525b'")
    content = content.replace("color: '#71717a'", "color: '#71717a'")
    
    # RGBA values
    content = content.replace("rgba(255,255,255,0.03)", "rgba(0,0,0,0.02)")
    content = content.replace("rgba(255,255,255,0.05)", "rgba(0,0,0,0.05)")
    content = content.replace("rgba(255,255,255,0.06)", "rgba(0,0,0,0.06)")
    content = content.replace("rgba(255,255,255,0.08)", "rgba(0,0,0,0.08)")
    content = content.replace("rgba(255,255,255,0.1)", "rgba(0,0,0,0.1)")
    content = content.replace("rgba(255,255,255,0.2)", "rgba(0,0,0,0.08)")
    
    # Specific LandingPage tweaks
    content = content.replace("background: '#000'", "background: '#ffffff'")
    content = content.replace("background: 'linear-gradient(135deg, #fff 0%, #a1a1aa 100%)'", "background: 'linear-gradient(135deg, #18181b 0%, #71717a 100%)'")
    
    # Specific Logo
    content = content.replace("new_logo_white.png", "new_logo.png")
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

process_file('src/pages/Landing/LandingPage.tsx')
process_file('src/features/auth/pages/LoginPage.tsx')
process_file('src/features/auth/components/AuthCard.tsx')
print("Done")
