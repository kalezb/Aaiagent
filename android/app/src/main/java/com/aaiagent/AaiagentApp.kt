package com.aaiagent

import android.app.Application

class AaiagentApp : Application() {
    companion object {
        lateinit var instance: AaiagentApp
            private set
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
    }
}