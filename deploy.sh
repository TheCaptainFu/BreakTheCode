#!/bin/bash

# 🚀 Break The Code - Quick Deploy Script

echo "🎮 Break The Code - Deployment Script"
echo "======================================"

# Check if git is initialized
if [ ! -d ".git" ]; then
    echo "📁 Initializing Git repository..."
    git init
    git branch -M main
fi

# Add all files
echo "📦 Adding files to Git..."
git add .

# Commit changes
echo "💾 Committing changes..."
git commit -m "🔒 Secure Break The Code Game - Ready for deployment"

echo ""
echo "🎯 Your game is ready for deployment!"
echo ""
echo "📋 Next Steps:"
echo "1. Create a GitHub repository"
echo "2. Add remote: git remote add origin https://github.com/yourusername/break-the-code.git"
echo "3. Push to GitHub: git push -u origin main"
echo "4. Deploy on Railway: https://railway.app"
echo ""
echo "🔗 Or deploy directly with these commands:"
echo "   git remote add origin YOUR_GITHUB_REPO_URL"
echo "   git push -u origin main"
echo ""
echo "🛡️ Security features enabled:"
echo "   ✅ Rate limiting"
echo "   ✅ Input validation"
echo "   ✅ Security headers"
echo "   ✅ Anti-cheat protection"
echo ""
echo "🎉 Happy gaming! 🎮" 